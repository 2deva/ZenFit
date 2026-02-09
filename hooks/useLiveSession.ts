/**
 * Enhanced Live Session Hook
 * 
 * Provides real-time voice interaction with context injection, voice commands,
 * error handling, and seamless integration with text mode.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { LiveServerMessage, Modality } from '@google/genai';
import { MODEL_LIVE, SYSTEM_INSTRUCTION } from '../constants';
import { ai } from '../services/opikGemini';
import {
  renderUIFunction,
  calendarFunction,
  getEventsFunction,
  startGuidedActivityFunction,
  controlActivityFunction,
  voiceFeedbackFunction,
  validateUIComponent
} from '../services/geminiService';
import { createPcmBlob, decodeAudioData, base64ToUint8Array, getSharedAudioContext, AUDIO_WORKLET_PROCESSOR_CODE } from '../utils/audioUtils';
import { UIComponentData, Message, SelectionOption, LiveStatus } from '../types';

// Import memory service for mid-session extraction
import {
  bufferTranscript,
  clearSessionBuffer,
  extractFromTranscription,
  extractAndStoreSessionSummary,
  generateSessionSummary,
  getSessionTranscripts
} from '../services/liveSessionMemoryService';

import { processToolInterceptors } from '../services/toolMiddleware';
import { normalizeTimerProps } from '../utils/timerProps';
import { resolveMindfulTimer } from '../utils/mindfulTimer';
import { isIntentSafeReadinessUtterance } from '../utils/liveReadiness';

import { createCalendarEvent, getUpcomingEvents } from '../services/calendarService';
import { useAuth } from '../contexts/AuthContext';
import { createScheduledEvent } from '../services/supabaseService';
import { getExercisePool } from '../services/exerciseGifService';
import { composePhysicalWorkoutFromRequest } from '../services/sessionGeneratorService';

// Import new services
import {
  UnifiedContext,
  buildSystemContext,
  shouldRefreshContext,
  createEmptyContext,
  updateContext
} from '../services/contextService';
import {
  processVoiceCommand,
  processSelection,
  createPaceState,
  adjustPace,
  pauseActivity,
  resumeActivity,
  generateDynamicResponse,
  setPendingConfirmation,
  consumeConfirmation,
  hasPendingConfirmation,
  clearPendingConfirmation,
  ActivityPaceState
} from '../services/voiceCommandsService';
import {
  createAudioQualityState,
  analyzeAudioQuality,
  generateVerbalFallback,
  createClarificationState,
  resetClarification,
  generateClarificationPrompt,
  generateErrorPrompt,
  shouldAdaptToAudioQuality,
  AudioQualityState,
  ClarificationState
} from '../services/errorHandlingService';
import {
  enhanceWithVoiceOptions
} from '../services/voiceOptionsGenerator';
import {
  getGuidanceExecutor,
  createGuidanceConfig
} from '../services/guidanceExecutor';
import {
  loadWorkoutRefs,
  saveWorkoutRefs,
  saveGuidanceState,
  loadGuidanceState,
  saveGuidanceExecutorState,
  loadGuidanceExecutorState,
  saveAutoReconnectState,
  loadAutoReconnectState,
  clearAutoReconnectState,
  clearGuidanceState
} from '../services/persistenceService';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

// Local LiveStatus type removed in favor of enum from types.ts

interface UseLiveSessionProps {
  // Existing callbacks
  onTranscription: (text: string, isUser: boolean, isFinal: boolean) => void;
  onAudioData?: (data: Float32Array) => void;
  onToolCall?: (component: UIComponentData) => void;
  onInterruption?: () => void;

  // New: Context injection
  getContext?: () => Promise<UnifiedContext>;
  conversationHistory?: Message[];

  // New: Voice command callbacks
  onVoiceCommand?: (action: string, response: string | null) => void;
  onPaceChange?: (pace: ActivityPaceState) => void;
  onActivityControl?: (action: 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'back' | 'reset') => void;

  // New: Error callbacks
  onError?: (type: string, message: string) => void;
  onReconnecting?: () => void;

  // New: Memory and activity callbacks
  userId?: string | null;  // For storing memories
  onGuidedActivityStart?: (activityType: string, config: any) => void;
  onMemoryExtracted?: (content: string, type: string) => void;

  // New: Guidance message callback
  onGuidanceMessage?: (message: { id: string; role: string; text: string; timestamp: number; messageContext: 'workout_guidance'; relatedWorkoutId?: string }) => void;

  // Active workout tracking
  activeWorkoutMessageId?: string | null;
}

interface LiveSessionState {
  turnCount: number;
  lastRefresh: number;
  resumptionToken?: string;
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export const useLiveSession = ({
  onTranscription,
  onAudioData,
  onToolCall,
  onInterruption,
  getContext,
  conversationHistory = [],
  onVoiceCommand,
  onPaceChange,
  onActivityControl,
  onError,
  onReconnecting,
  userId,
  onGuidedActivityStart,
  onMemoryExtracted,
  onGuidanceMessage,
  activeWorkoutMessageId
}: UseLiveSessionProps) => {
  // Connection state
  const [status, setStatus] = useState<LiveStatus>(LiveStatus.DISCONNECTED);
  const connectAbortControllerRef = useRef<AbortController | null>(null);

  // Activity state
  const [paceState, setPaceState] = useState<ActivityPaceState>(createPaceState('normal'));
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { accessToken } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'fair' | 'poor'>('good');

  // Update connection quality periodically
  useEffect(() => {
    if (!isConnectedRef.current) return;
    const interval = setInterval(() => {
      const quality = audioQualityRef.current;
      const adaptation = shouldAdaptToAudioQuality(quality);

      if (!adaptation.shouldAdapt) {
        setConnectionQuality('good');
      } else if (adaptation.reason === 'dropouts') {
        setConnectionQuality('poor');
      } else {
        setConnectionQuality('fair');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status]);

  // Refs for synchronous access
  const isConnectedRef = useRef(false);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sessionRef = useRef<any>(null); // Store actual session object for GuidanceExecutor
  const sessionStateRef = useRef<LiveSessionState>({
    turnCount: 0,
    lastRefresh: Date.now()
  });
  const liveSessionMetaRef = useRef<{
    sessionId: string;
    startedAt: number;
    userMessageCount: number;
    aiMessageCount: number;
    lastUserMessage: string;
    lastAiMessage: string;
  } | null>(null);
  const liveSessionLoggedRef = useRef<boolean>(false);
  const keepaliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastGuidanceCueTimeRef = useRef<number>(0);
  const nextGuidanceCueAtRef = useRef<number>(0);

  // Store reference to guidance executor for external control
  const guidanceExecutorRef = useRef<any>(null);

  // Track rest period state for recovery
  const currentRestStateRef = useRef<{ isResting: boolean; restDuration?: number; exerciseIndex?: number } | null>(null);

  // Helper function to send guidance cue to Gemini Live for TTS and create guidance message
  const sendGuidanceCueToGemini = useCallback((text: string, cueType: string) => {
    console.log(`LiveSession: Attempting to send guidance cue [${cueType}]:`, text);
    console.log(`LiveSession: Session state - Connected: ${isConnectedRef.current}, Ready: ${isSessionReadyRef.current}, Session exists: ${!!sessionRef.current}`);

    if (sessionRef.current && isConnectedRef.current && isSessionReadyRef.current) {
      try {
        // Queue guidance cues with a small minimum gap so countdown numbers stay ordered
        // and the live API is not flooded by back-to-back turns.
        const minDelay = cueType === 'count' ? 900 : 500;
        const now = Date.now();
        const scheduledAt = Math.max(now, nextGuidanceCueAtRef.current);
        nextGuidanceCueAtRef.current = scheduledAt + minDelay;

        const sendCue = () => {
          // Double-check session is still ready before sending
          if (!sessionRef.current || !isConnectedRef.current || !isSessionReadyRef.current) {
            console.warn(`LiveSession: Session became unavailable before sending cue [${cueType}]`);
            return;
          }

          try {
            // Prefix all guidance cues with [SPEAK]: to trigger exact speech behavior
            // This tells Gemini to speak ONLY the text after the prefix, no additions
            const cueToSend = `[SPEAK]: ${text}`;

            // Send as user input - Gemini will respond by speaking it
            // System instructions tell Gemini to speak guidance cues directly without conversational responses
            sessionRef.current.sendClientContent({
              turns: [{
                role: 'user',
                parts: [{ text: cueToSend }]
              }],
              turnComplete: true // Allow Gemini to process and respond with speech
            });

            // Mark that we're expecting a guidance response and guidance is active
            isExpectingGuidanceResponseRef.current = true;
            // Ensure guidance active state is set (safety check)
            if (!isGuidanceActiveRef.current) {
              isGuidanceActiveRef.current = true;
            }

            lastGuidanceCueTimeRef.current = Date.now();
            console.log(`LiveSession: ✅ Successfully sent guidance cue [${cueType}] to Gemini for TTS`);
          } catch (error: any) {
            const msg = typeof error?.message === 'string' ? error.message : '';
            const errStr = String(error);

            // Handle WebSocket closure gracefully
            if (/CLOSING|CLOSED|WebSocket.*CLOS/i.test(msg) || /CLOSING|CLOSED|WebSocket.*CLOS/i.test(errStr)) {
              console.warn(`LiveSession: WebSocket closed while sending guidance cue [${cueType}] - will reconnect`);
              isSessionReadyRef.current = false;

              // If guidance is active, pause it and trigger reconnection
              const executor = getGuidanceExecutor();
              const progress = executor.getProgress();
              if ((progress.status === 'active' || progress.status === 'paused') && !manualDisconnectRef.current) {
                if (progress.status === 'active') {
                  executor.pause();
                }
                // Trigger reconnection
                setTimeout(() => disconnect(false), 0);
              }
            } else {
              console.error('LiveSession: ❌ Failed to send guidance cue:', error);
            }
          }
        };

        const delay = Math.max(0, scheduledAt - now);
        if (delay > 0) {
          setTimeout(sendCue, delay);
        } else {
          sendCue();
        }

        // NOTE: No need to create separate guidance messages here anymore
        // The actual Gemini response will be categorized as guidance in App.tsx
        // This prevents duplicate messages in the UI
      } catch (error) {
        console.error('LiveSession: ❌ Failed to send guidance cue:', error);
        // Don't break guidance if send fails
      }
    } else {
      console.warn(`LiveSession: ❌ Cannot send cue - session not ready. Connected: ${isConnectedRef.current}, Ready: ${isSessionReadyRef.current}, Session: ${!!sessionRef.current}`);

      // If guidance is active but session is not ready, attempt reconnection
      const executor = getGuidanceExecutor();
      const progress = executor.getProgress();
      if ((progress.status === 'active' || progress.status === 'paused') && !isConnectedRef.current && !manualDisconnectRef.current) {
        console.log('LiveSession: Guidance active but disconnected - attempting reconnection');
        // Connect will handle resuming guidance if needed
        setTimeout(() => connect(), 100);
      }
    }
  }, []);

  // Start keepalive mechanism during guidance to prevent disconnection
  const startGuidanceKeepalive = useCallback(() => {
    // Clear any existing keepalive
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
    }

    // Send keepalive every 25 seconds (before 30s timeout)
    keepaliveIntervalRef.current = setInterval(() => {
      const executor = getGuidanceExecutor();
      const progress = executor.getProgress();

      // Only send keepalive if guidance is active and session is connected
      if (progress.status === 'active' && sessionRef.current && isConnectedRef.current && isSessionReadyRef.current) {
        const timeSinceLastCue = Date.now() - lastGuidanceCueTimeRef.current;

        // Only send keepalive if it's been more than 20 seconds since last cue
        // This prevents unnecessary keepalives when cues are frequent
        if (timeSinceLastCue > 20000) {
          try {
            // Send minimal keepalive to prevent session timeout
            // Note: Sending as model role to avoid triggering a response
            sessionRef.current.sendClientContent({
              turns: [{
                role: 'model',
                parts: [{ text: ' ' }] // Minimal space to keep connection alive
              }],
              turnComplete: false
            });
            console.log('LiveSession: Sent guidance keepalive (no activity for', Math.round(timeSinceLastCue / 1000), 'seconds)');
          } catch (error) {
            console.warn('LiveSession: Keepalive send failed:', error);
            // If keepalive fails, session might be disconnecting - stop it
            if (error instanceof Error && (error.message.includes('closed') || error.message.includes('disconnect'))) {
              stopGuidanceKeepalive();
            }
          }
        }
      } else if (progress.status !== 'active') {
        // Stop keepalive if guidance is not active
        stopGuidanceKeepalive();
      }
    }, 25000); // Every 25 seconds
  }, []);

  // Stop keepalive mechanism
  const stopGuidanceKeepalive = useCallback(() => {
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
      console.log('LiveSession: Stopped guidance keepalive');
    }
  }, []);

  // NEW: Active Selection Ref
  const activeSelectionRef = useRef<SelectionOption[]>([]);
  const selectionModeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track workoutLists by message ID for proper multi-workout support
  const workoutListsMapRef = useRef<Map<string, { exercises: any[]; title: string; timestamp: number }>>(new Map());

  // Track last workoutList shown for auto-start detection (backward compatibility)
  const lastWorkoutListRef = useRef<{ exercises: any[]; title: string; timestamp: number; messageId?: string } | null>(null);

  // Track last timer shown for auto-start detection
  const lastTimerRef = useRef<{ label: string; duration: number; activityType: string; config: any; timestamp: number } | null>(null);

  const buildMindfulTimerActivity = useCallback((timerProps: any) => {
    const duration = timerProps?.duration ?? 60;
    const label = timerProps?.label || 'Timer';
    const resolved = resolveMindfulTimer(timerProps);
    const activityType = resolved.activityType;

    if (!activityType) {
      return null;
    }

    const totalMinutes = Math.max(1, Math.floor(duration / 60));
    const intent =
      resolved.intent ||
      (activityType === 'breathing'
        ? 'breathing_reset'
        : label.toLowerCase().includes('sleep')
          ? 'sleep_prep'
          : 'deep_meditation');

    const config: any = {
      duration,
      durationMinutes: totalMinutes,
      label,
      guidanceStyle: resolved.guidanceStyle || 'light',
      intent,
      phases: resolved.phases
    };

    if (activityType === 'breathing') {
      config.pattern = {
        name: resolved.pattern || 'box',
        cycles: Math.max(1, Math.floor(duration / 60))
      };
    }

    return { activityType, config };
  }, []);

  // Load workout refs from persistence on mount
  useEffect(() => {
    const loadWorkoutRefsData = async () => {
      try {
        // const { loadWorkoutRefs } = await import('../services/persistenceService'); // Using static import
        const savedRefs = loadWorkoutRefs();
        if (savedRefs) {
          // Restore workout lists map
          if (savedRefs.workoutListsMap) {
            workoutListsMapRef.current = new Map(savedRefs.workoutListsMap);
          }
          // Restore last workout list
          if (savedRefs.lastWorkoutList) {
            lastWorkoutListRef.current = savedRefs.lastWorkoutList;
            // Update map if messageId exists
            if (savedRefs.lastWorkoutList.messageId) {
              workoutListsMapRef.current.set(savedRefs.lastWorkoutList.messageId, {
                exercises: savedRefs.lastWorkoutList.exercises,
                title: savedRefs.lastWorkoutList.title,
                timestamp: savedRefs.lastWorkoutList.timestamp
              });
            }
          }
          if (savedRefs.lastTimer) {
            lastTimerRef.current = savedRefs.lastTimer;
          }
          console.log('LiveSession: Loaded workout refs from persistence');
        }
      } catch (e) {
        console.warn('Failed to load workout refs:', e);
      }
    };
    loadWorkoutRefsData();
  }, []);

  // Track message ID with workoutList for dynamic updates and guidance message linking
  const workoutListMessageIdRef = useRef<string | null>(null);

  // Track when we're expecting a guidance response to categorize it properly
  const isExpectingGuidanceResponseRef = useRef(false);

  // Track if guidance is currently active (for robust message categorization)
  const isGuidanceActiveRef = useRef(false);

  // Callback to update workoutList message props
  const updateWorkoutListMessageRef = useRef<((messageId: string, updates: { controlledActiveIndex?: number; controlledCompleted?: number[] }) => void) | null>(null);

  // Track guidance message callback
  const onGuidanceMessageRef = useRef(onGuidanceMessage);
  useEffect(() => { onGuidanceMessageRef.current = onGuidanceMessage; }, [onGuidanceMessage]);

  // Update workoutListMessageId when activeWorkoutMessageId changes
  useEffect(() => {
    workoutListMessageIdRef.current = activeWorkoutMessageId;
  }, [activeWorkoutMessageId]);

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // On some mobile browsers, playing audio while the mic is active can route audio to the earpiece.
  // A common workaround is to route WebAudio output through a media element.
  // This is best-effort only (platform limitations apply).
  const outputStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const outputAudioElRef = useRef<HTMLAudioElement | null>(null);
  const useMediaElementOutputRef = useRef<boolean>(false);

  // Error handling refs
  const audioQualityRef = useRef<AudioQualityState>(createAudioQualityState());
  const clarificationRef = useRef<ClarificationState>(createClarificationState());

  // Context ref for current state
  const contextRef = useRef<UnifiedContext>(createEmptyContext());

  // Session ready state - true only when WebSocket is open and ready
  const isSessionReadyRef = useRef(false);

  // Callback Refs (Proxy pattern to prevent stale closures)
  const onTranscriptionRef = useRef(onTranscription);
  const onToolCallRef = useRef(onToolCall);
  const onInterruptionRef = useRef(onInterruption);
  const onGuidedActivityStartRef = useRef(onGuidedActivityStart);
  const onActivityControlRef = useRef(onActivityControl);
  const onVoiceCommandRef = useRef(onVoiceCommand);
  const onPaceChangeRef = useRef(onPaceChange);
  const onErrorRef = useRef(onError);
  const onReconnectingRef = useRef(onReconnecting);
  const onMemoryExtractedRef = useRef(onMemoryExtracted);
  const onAudioDataRef = useRef(onAudioData);
  const getContextRef = useRef(getContext);
  const lastUserMessageRef = useRef<string>('');
  const manualDisconnectRef = useRef<boolean>(false);
  const wsClosingHandledRef = useRef<boolean>(false);
  const connectFnRef = useRef<(() => Promise<void>) | null>(null);

  // State sync refs to avoid reconnecting on state changes
  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(paceState.isPaused);

  // Update refs on every render
  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onToolCallRef.current = onToolCall; }, [onToolCall]);
  useEffect(() => { onInterruptionRef.current = onInterruption; }, [onInterruption]);
  useEffect(() => { onGuidedActivityStartRef.current = onGuidedActivityStart; }, [onGuidedActivityStart]);
  useEffect(() => { onActivityControlRef.current = onActivityControl; }, [onActivityControl]);
  useEffect(() => { onVoiceCommandRef.current = onVoiceCommand; }, [onVoiceCommand]);
  useEffect(() => { onPaceChangeRef.current = onPaceChange; }, [onPaceChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onReconnectingRef.current = onReconnecting; }, [onReconnecting]);
  useEffect(() => { onMemoryExtractedRef.current = onMemoryExtracted; }, [onMemoryExtracted]);
  useEffect(() => { onAudioDataRef.current = onAudioData; }, [onAudioData]);
  useEffect(() => { getContextRef.current = getContext; }, [getContext]);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isPausedRef.current = paceState.isPaused; }, [paceState.isPaused]);

  // Shared Opik-tracked Gemini client (see services/opikGemini.ts)

  // ──────────────────────────────────────────────────────────────────────────
  // AUDIO CLEANUP
  // ──────────────────────────────────────────────────────────────────────────

  const ensureMobileSpeakerOutput = useCallback(async (ctx: AudioContext) => {
    // Only attempt on mobile-ish UAs; keep desktop behavior unchanged.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    if (!isMobile) {
      useMediaElementOutputRef.current = false;
      return;
    }

    try {
      // Lazily create a MediaStream destination and pipe it through a hidden <audio>.
      if (!outputStreamDestRef.current) {
        outputStreamDestRef.current = ctx.createMediaStreamDestination();
      }

      if (!outputAudioElRef.current) {
        const el = document.createElement('audio');
        el.autoplay = true;
        // @ts-expect-error - playsInline exists on iOS Safari but isn't in all TS lib defs.
        el.playsInline = true;
        el.setAttribute('playsinline', 'true');
        el.muted = false;
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.opacity = '0';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        outputAudioElRef.current = el;
      }

      const el = outputAudioElRef.current!;
      if (el.srcObject !== outputStreamDestRef.current!.stream) {
        el.srcObject = outputStreamDestRef.current!.stream;
      }

      // If this fails due to autoplay restrictions, we fall back to direct output.
      await el.play();
      useMediaElementOutputRef.current = true;
    } catch {
      useMediaElementOutputRef.current = false;
    }
  }, []);

  const cleanupAudio = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current.port.close();
      workletNodeRef.current = null;
    }

    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }

    if (inputContextRef.current) {
      if (inputContextRef.current.state !== 'closed') inputContextRef.current.close();
      inputContextRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'running') {
        audioContextRef.current.suspend().catch(() => { });
      }
      audioContextRef.current = null;
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    sourcesRef.current.clear();

    // Best-effort cleanup for mobile audio routing hack
    useMediaElementOutputRef.current = false;
    if (outputAudioElRef.current) {
      try {
        outputAudioElRef.current.pause();
        outputAudioElRef.current.srcObject = null;
        outputAudioElRef.current.remove();
      } catch { /* ignore */ }
      outputAudioElRef.current = null;
    }
    outputStreamDestRef.current = null;
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // DISCONNECT
  // ──────────────────────────────────────────────────────────────────────────

  const disconnect = useCallback(async (manual: boolean = true) => {
    setErrorMessage(null);
    manualDisconnectRef.current = manual;
    // Stop keepalive on disconnect
    stopGuidanceKeepalive();

    // Abort any pending connection attempts
    if (connectAbortControllerRef.current) {
      connectAbortControllerRef.current.abort();
      connectAbortControllerRef.current = null;
    }

    // IMPORTANT: Save guidance state before fully disconnecting
    // This allows resumption when reconnected
    const executor = getGuidanceExecutor();
    const progress = executor.getProgress();
    if (progress.status === 'active' || progress.status === 'paused') {
      console.log('LiveSession: Saving guidance state before disconnect');
      executor.pause(); // Pause to preserve state

      // Store guidance state for recovery (including rest period state and detailed executor state)
      try {
        // Save high-level guidance state
        await saveGuidanceState({
          status: progress.status,
          activityType: progress.activityType,
          currentExerciseIndex: progress.currentExerciseIndex,
          totalExercises: progress.totalExercises,
          completedExercises: progress.completedExercises,
          elapsedTime: progress.elapsedTime,
          // Include rest period state if active
          isResting: currentRestStateRef.current?.isResting || false,
          restDuration: currentRestStateRef.current?.restDuration,
          restExerciseIndex: currentRestStateRef.current?.exerciseIndex,
          timestamp: Date.now()
        }, userId || undefined, activeWorkoutMessageId || undefined);

        // Fallback: Synchronous backup to localStorage in case async save fails
        try {
          const minimalState = {
            activityType: progress.activityType,
            currentExerciseIndex: progress.currentExerciseIndex,
            completedExercises: progress.completedExercises?.map((e: any) => e.name),
            timestamp: Date.now(),
            pendingSync: true // Flag to indicate this needs to be synced to DB next load
          };
          localStorage.setItem('zen_guidance_backup', JSON.stringify(minimalState));
        } catch (e) { console.warn('Backup save failed', e); }

        // Save detailed executor state for seamless resume
        const executor = getGuidanceExecutor();
        const detailedState = executor.getDetailedState();
        saveGuidanceExecutorState({
          ...detailedState,
          timestamp: Date.now()
        });
      } catch (e) {
        console.warn('Failed to save guidance state:', e);
      }
    }

    // Save auto-reconnect state ONLY if NOT manual and guidance was active
    if (!manual && (progress.status === 'active' || progress.status === 'paused')) {
      try {
        saveAutoReconnectState({
          shouldAutoReconnect: true,
          reason: progress.activityType === 'workout' ? 'workout_in_progress' : 'guidance_active',
          timestamp: Date.now()
        });
      } catch (e) {
        console.warn('Failed to save auto-reconnect state:', e);
      }
    } else if (manual) {
      // Explicitly clear auto-reconnect if user manually disconnects
      try {
        clearAutoReconnectState();
      } catch (e) {
        console.warn('Failed to clear auto-reconnect state:', e);
      }
    }

    // Reset guidance state on disconnect (guidance can't continue without session)
    isGuidanceActiveRef.current = false;
    isExpectingGuidanceResponseRef.current = false;
    nextGuidanceCueAtRef.current = 0;
    console.log("Disconnecting Live Session...");
    isConnectedRef.current = false;
    isSessionReadyRef.current = false; // Stop audio sending immediately

    // Store resumption token before disconnecting (only if not manual? - keep for now)
    if (sessionStateRef.current.resumptionToken) {
      try {
        localStorage.setItem('zen_live_session', JSON.stringify({
          token: sessionStateRef.current.resumptionToken,
          timestamp: Date.now(),
          turnCount: sessionStateRef.current.turnCount
        }));
      } catch (e) {
        console.warn('Failed to save session state:', e);
      }
    }

    // Generate summary ONCE for Opik logging (best-effort)
    let opikSummary: any = null;
    try {
      opikSummary = await generateSessionSummary();
    } catch (e) {
      console.warn('LiveSession: Failed to generate summary for Opik logging:', e);
    }

    // Log Live session to Opik (best-effort)
    if (!liveSessionLoggedRef.current && liveSessionMetaRef.current) {
      liveSessionLoggedRef.current = true;
      try {
        const meta = liveSessionMetaRef.current!;
        const transcripts = getSessionTranscripts(30);
        const payload = {
          sessionId: meta.sessionId,
          startedAt: meta.startedAt,
          endedAt: Date.now(),
          durationMinutes: opikSummary?.duration ?? Math.max(0, Math.round((Date.now() - meta.startedAt) / 60000)),
          userMessageCount: meta.userMessageCount,
          aiMessageCount: meta.aiMessageCount,
          lastUserMessage: meta.lastUserMessage,
          lastAiMessage: meta.lastAiMessage,
          transcripts,
          summary: opikSummary ? {
            userHighlights: opikSummary.userHighlights,
            activitiesCompleted: opikSummary.activitiesCompleted,
            memorableQuotes: opikSummary.memorableQuotes,
            mood: opikSummary.mood,
            briefSummary: opikSummary.aiResponses?.[0] || ''
          } : null,
          mode: 'live'
        };

        await fetch('/api/opik/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.warn('Opik live session log failed:', e);
      }
    }

    // Extract and store session summary for memory persistence
    if (userId) {
      try {
        await extractAndStoreSessionSummary(userId);
        console.log('Session memories stored successfully');
      } catch (e) {
        console.warn('Failed to store session memories:', e);
      }
    }

    // Close the session explicitly
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => {
        try {
          if (session && typeof session.close === 'function') {
            session.close();
          }
        } catch (e) { console.warn('Error closing session:', e); }
      }).catch(() => { });
    }

    sessionPromiseRef.current = null;
    sessionRef.current = null; // Clear session reference
    cleanupAudio();
    setStatus(LiveStatus.DISCONNECTED);

    // Reset state
    setPaceState(createPaceState('normal'));
    audioQualityRef.current = createAudioQualityState();
    clarificationRef.current = createClarificationState();

    // Clear transcript buffer for next session
    clearSessionBuffer();
    liveSessionMetaRef.current = null;
  }, [cleanupAudio, userId]);

  // ──────────────────────────────────────────────────────────────────────────
  // VOICE COMMAND PROCESSING
  // ──────────────────────────────────────────────────────────────────────────

  const handleVoiceCommand = useCallback((transcript: string): boolean => {
    // 1. Check for Active Selection Mode
    if (activeSelectionRef.current.length > 0) {
      console.log('LiveSession: Processing selection input:', transcript);

      const selectionResult = processSelection(transcript, activeSelectionRef.current);

      if (selectionResult) {
        if (selectionResult.confidence === 'high') {
          const selectedOption = activeSelectionRef.current.find(o => o.id === selectionResult.selectedId);
          if (selectedOption) {
            console.log('LiveSession: Selected', selectedOption.label);

            // Clear selection mode
            activeSelectionRef.current = [];
            if (selectionModeTimeoutRef.current) clearTimeout(selectionModeTimeoutRef.current);

            // Inform the user
            const confirmationMsg = `Starting ${selectedOption.label}`;
            if (onVoiceCommandRef.current) onVoiceCommandRef.current('SELECTION_CONFIRMED', confirmationMsg);

            // Handle selection based on action type
            const action = selectedOption.data?.action;
            let continueToReadinessCheck = false;

            if (action === 'startGuided' && selectedOption.data?.exercises) {
              startGuidanceForWorkout('workout', {
                title: selectedOption.data.title || 'Workout',
                exercises: selectedOption.data.exercises
              });
              return true;
            } else if (action === 'start') {
              if (selectedOption.data?.exercises) {
                startGuidanceForWorkout('workout', {
                  title: selectedOption.data.title || 'Workout',
                  exercises: selectedOption.data.exercises
                });
                return true;
              }

              if (!lastTimerRef.current) {
                if (onVoiceCommandRef.current) {
                  onVoiceCommandRef.current('CLARIFICATION', "I don't see an active mindful timer to start yet.");
                }
                return true;
              }
              continueToReadinessCheck = true;
            } else if (action === 'startSolo' && selectedOption.data?.exercises) {
              // Start without guidance - just notify parent
              if (onGuidedActivityStartRef.current) {
                onGuidedActivityStartRef.current('workout', {
                  title: selectedOption.data.title,
                  exercises: selectedOption.data.exercises,
                  noGuidance: true
                });
              }
            } else if (selectedOption.data?.type === 'workout') {
              // Legacy handling for direct workout selection
              if (onGuidedActivityStartRef.current) {
                onGuidedActivityStartRef.current('workout', selectedOption.data);
              }
            }
            if (!continueToReadinessCheck) {
              return true;
            }
          }
        } else if (selectionResult.confidence === 'medium' && selectionResult.requiresConfirmation) {
          // Ask for confirmation
          const selectedOption = activeSelectionRef.current.find(o => o.id === selectionResult.selectedId);
          if (selectedOption) {
            const prompt = generateClarificationPrompt(transcript, [selectedOption.label, "something else"]);
            setPendingConfirmation(`SELECT_${selectedOption.id}`);
            if (onVoiceCommandRef.current) onVoiceCommandRef.current('CONFIRM_SELECTION', prompt);
            return true;
          }
        }
      } else {
        // No match in selection mode
        // Only intervene if input is substantial enough to be an attempt
        if (transcript.trim().length > 2) {
          const cmdResult = processVoiceCommand(transcript);
          if (!cmdResult.action) {
            // It's likely a failed selection attempt
            const prompt = generateClarificationPrompt(transcript, activeSelectionRef.current.map(o => o.label));
            if (onVoiceCommandRef.current) onVoiceCommandRef.current('CLARIFICATION', prompt);
            return true;
          }
        }
      }
    }

    // NOTE: UI/tool decisions (timers, workout lists, dashboards) are surfaced
    // through the same `renderUI` contract that text chat uses. Live mode
    // relies on identical `UIComponentData` so Opik can evaluate tool behavior
    // consistently across both modalities.

    // Check for auto-start readiness phrases when workoutList or timer is available
    const isReadinessPhrase = isIntentSafeReadinessUtterance(transcript);

    // PRIORITY: If user says ready and we have a recent timer, auto-start guidance for timer
    if (isReadinessPhrase && lastTimerRef.current) {
      const timeSinceTimer = Date.now() - lastTimerRef.current.timestamp;
      // Only auto-start if timer was shown in last 60 seconds
      if (timeSinceTimer < 60000) {
        // Check if we need to reconnect first
        const executor = getGuidanceExecutor();
        const progress = executor.getProgress();
        const hasPausedGuidance =
          progress.status === 'paused' &&
          (progress.activityType === 'breathing' || progress.activityType === 'meditation' || progress.activityType === 'timer');

        // If guidance is paused and session is disconnected, reconnect first
        if (hasPausedGuidance && !isConnectedRef.current && connectFnRef.current) {
          console.log('LiveSession: Reconnecting before resuming guidance for timer');
          // Connect will handle resuming guidance after connection is established
          connectFnRef.current().then(() => {
            // After connection, resume guidance
            setTimeout(() => {
              if (guidanceExecutorRef.current) {
                const exec = guidanceExecutorRef.current;
                const prog = exec.getProgress();
                if (prog.status === 'paused') {
                  resumeGuidance();
                }
              }
            }, 500);
          }).catch(err => {
            console.error('LiveSession: Failed to reconnect:', err);
          });
          return true; // Handled
        }

        console.log('LiveSession: Auto-starting guidance for timer on readiness phrase');

        const { activityType, config } = lastTimerRef.current;
        startGuidanceForTimer(activityType, config);

        return true; // Handled
      }
    }

    // If user says ready and we have a recent workoutList, auto-start guidance
    // Prefer activeWorkoutMessageId if set, otherwise use lastWorkoutListRef
    let workoutToUse = null;
    if (activeWorkoutMessageId && workoutListsMapRef.current.has(activeWorkoutMessageId)) {
      workoutToUse = workoutListsMapRef.current.get(activeWorkoutMessageId)!;
      console.log('LiveSession: Using workout from activeWorkoutMessageId:', activeWorkoutMessageId);
    } else if (lastWorkoutListRef.current) {
      workoutToUse = lastWorkoutListRef.current;
      console.log('LiveSession: Using workout from lastWorkoutListRef');
    }

    if (isReadinessPhrase && workoutToUse) {
      const timeSinceWorkoutList = Date.now() - workoutToUse.timestamp;
      // Only auto-start if workoutList was shown in last 60 seconds
      if (timeSinceWorkoutList < 60000) {
        // Check if we need to reconnect first
        const executor = getGuidanceExecutor();
        const progress = executor.getProgress();
        const hasPausedGuidance = progress.status === 'paused' && progress.activityType === 'workout';

        // If guidance is paused and session is disconnected, reconnect first
        if (hasPausedGuidance && !isConnectedRef.current && connectFnRef.current) {
          console.log('LiveSession: Reconnecting before resuming workout guidance');
          // Update lastWorkoutListRef before reconnecting
          lastWorkoutListRef.current = workoutToUse;
          // Connect will handle resuming guidance after connection is established
          connectFnRef.current().then(() => {
            // After connection, resume guidance
            setTimeout(() => {
              if (guidanceExecutorRef.current) {
                const exec = guidanceExecutorRef.current;
                const prog = exec.getProgress();
                if (prog.status === 'paused' && prog.activityType === 'workout') {
                  resumeGuidance();
                }
              }
            }, 500);
          }).catch(err => {
            console.error('LiveSession: Failed to reconnect:', err);
          });
          return true; // Handled
        }

        console.log('LiveSession: Auto-starting guidance on readiness phrase');
        startGuidanceForWorkout('workout', {
          title: workoutToUse.title,
          exercises: workoutToUse.exercises
        }, { attemptRestoreDetailedState: true });
        return true; // Handled
      }
    }

    const result = processVoiceCommand(transcript);

    if (!result.action) {
      return false; // No command recognized
    }

    console.log(`Voice Command: ${result.action}`);

    // Handle confirmation flow
    if (result.action === 'CONFIRM' && hasPendingConfirmation()) {
      const confirmedAction = consumeConfirmation();
      if (confirmedAction) {
        if (confirmedAction.startsWith('SELECT_')) {
          const id = confirmedAction.replace('SELECT_', '');
          const selectedOption = activeSelectionRef.current.find(o => o.id === id);
          if (selectedOption) {
            activeSelectionRef.current = [];
            if (selectionModeTimeoutRef.current) clearTimeout(selectionModeTimeoutRef.current);

            if (onVoiceCommandRef.current) onVoiceCommandRef.current('SELECTION_CONFIRMED', `Starting ${selectedOption.label}`);
            if (selectedOption.data?.type === 'workout' && onGuidedActivityStartRef.current) {
              onGuidedActivityStartRef.current('workout', selectedOption.data);
            }
            return true;
          }
        } else if (confirmedAction === 'END_SESSION') {
          if (onActivityControlRef.current) onActivityControlRef.current('stop');
          disconnect(true);
        } else if (confirmedAction === 'RESTART_ACTIVITY') {
          if (onActivityControlRef.current) onActivityControlRef.current('back');
        }
        if (onVoiceCommandRef.current) onVoiceCommandRef.current(confirmedAction, "Confirmed.");
        return true;
      }
    }

    if (result.action === 'CANCEL') {
      clearPendingConfirmation();
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle actions that require confirmation
    if (result.requiresConfirmation) {
      setPendingConfirmation(result.action);
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle pace controls
    if (result.action === 'SLOW_PACE' || result.action === 'SPEED_PACE') {
      const executor = getGuidanceExecutor();
      executor.adjustPace(result.action === 'SLOW_PACE' ? 'slow' : 'fast');

      const newPace = adjustPace(paceState, result.action);
      setPaceState(newPace);
      if (onPaceChangeRef.current) onPaceChangeRef.current(newPace);
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle pause/resume
    if (result.action === 'PAUSE_ACTIVITY') {
      const executor = getGuidanceExecutor();
      executor.pause();

      const newPace = pauseActivity(paceState);
      setPaceState(newPace);
      if (onPaceChangeRef.current) onPaceChangeRef.current(newPace);
      if (onActivityControlRef.current) onActivityControlRef.current('pause');
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    if (result.action === 'RESUME_ACTIVITY') {
      const executor = getGuidanceExecutor();
      executor.resume();

      const newPace = resumeActivity(paceState);
      setPaceState(newPace);
      if (onPaceChangeRef.current) onPaceChangeRef.current(newPace);
      if (onActivityControlRef.current) onActivityControlRef.current('resume');
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle navigation
    if (result.action === 'SKIP_CURRENT') {
      const executor = getGuidanceExecutor();
      executor.skip();

      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    if (result.action === 'GO_BACK') {
      const executor = getGuidanceExecutor();
      executor.goBack();

      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle mute
    if (result.action === 'MUTE_GUIDANCE') {
      setIsMuted(true);
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    if (result.action === 'UNMUTE_GUIDANCE') {
      setIsMuted(false);
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle dynamic responses (time check, status)
    if (result.action === 'TIME_CHECK' || result.action === 'CURRENT_STATUS' || result.action === 'EXERCISES_REMAINING') {
      const statusData = {
        currentExercise: contextRef.current.currentWorkoutProgress?.remainingExercises?.[0],
        currentExerciseIndex: contextRef.current.currentWorkoutProgress?.completedCount,
        totalExercises: contextRef.current.currentWorkoutProgress?.totalExercises,
        remainingTime: contextRef.current.activeTimer?.remainingSeconds,
        elapsedTime: contextRef.current.currentWorkoutProgress?.minutesSinceStarted ?
          contextRef.current.currentWorkoutProgress.minutesSinceStarted * 60 : undefined,
        completedCount: contextRef.current.currentWorkoutProgress?.completedCount
      };
      const dynamicResponse = generateDynamicResponse(result.action, statusData);
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, dynamicResponse);
      return true;
    }

    // Handle help
    if (result.action === 'SHOW_HELP') {
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle rep confirmation for adaptive pacing
    if (result.action === 'CONFIRM_REP') {
      const executor = getGuidanceExecutor();
      // Extract rep number if mentioned (e.g., "rep 5", "done", "next")
      const repMatch = transcript.match(/(\d+)/);
      const repNumber = repMatch ? parseInt(repMatch[1]) : undefined;
      executor.confirmRep(repNumber);
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Handle "done" or "finished" for completing current exercise
    if (result.action === 'COMPLETE_EXERCISE') {
      // Check if we're currently in a rest period - don't skip rest periods
      if (currentRestStateRef.current?.isResting) {
        console.log('LiveSession: "Done" command ignored during rest period');
        // Optionally, provide feedback that rest is in progress
        if (onVoiceCommandRef.current) {
          onVoiceCommandRef.current(result.action, `Rest period in progress. ${currentRestStateRef.current.restDuration || 30} seconds remaining.`);
        }
        return true; // Handled (by ignoring)
      }

      const executor = getGuidanceExecutor();
      const progress = executor.getRepProgress();
      // Set current rep to target to complete exercise
      if (progress.target > 0) {
        executor.confirmRep(progress.target);
      } else {
        executor.skip(); // Use skip for non-rep exercises
      }
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    // Reset clarification on successful command
    clarificationRef.current = resetClarification(clarificationRef.current);

    return false;
  }, [paceState, disconnect]);

  // ──────────────────────────────────────────────────────────────────────────
  // CONNECT
  // ──────────────────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isConnectedRef.current) return;

    try {
      console.log("Initializing Live Session...");
      liveSessionMetaRef.current = {
        sessionId: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `live_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        startedAt: Date.now(),
        userMessageCount: 0,
        aiMessageCount: 0,
        lastUserMessage: '',
        lastAiMessage: ''
      };
      liveSessionLoggedRef.current = false;
      setErrorMessage(null);
      manualDisconnectRef.current = false;
      wsClosingHandledRef.current = false;

      // create new abort controller for this connection attempt
      const abortController = new AbortController();
      connectAbortControllerRef.current = abortController;

      setStatus(LiveStatus.CONNECTING);
      isConnectedRef.current = true;

      // Reset state
      sessionStateRef.current = {
        turnCount: 0,
        lastRefresh: Date.now()
      };

      // 1. Build context for system instruction
      let systemContext = SYSTEM_INSTRUCTION;
      if (getContextRef.current) {
        try {
          const context = await getContextRef.current();
          context.voiceSessionActive = true;
          context.lastContextRefresh = Date.now();
          context.conversationTurnCount = 0;

          // Add recent conversation summary for continuity
          if (conversationHistory.length > 0) {
            context.recentConversation = conversationHistory.slice(-5).map(m => ({
              role: m.role,
              text: m.text.substring(0, 150)
            }));
          }

          contextRef.current = context;
          systemContext = buildSystemContext(context, conversationHistory);
        } catch (e) {
          console.warn('Failed to build context:', e);
        }
      }

      // 2. Check for session resumption
      let resumptionConfig = {};
      try {
        const savedSession = localStorage.getItem('zen_live_session');
        if (savedSession) {
          const parsed = JSON.parse(savedSession);
          // Only resume if session is less than 1 hour old
          if (Date.now() - parsed.timestamp < 3600000) {
            resumptionConfig = { sessionResumption: { handle: parsed.token } };
            console.log('Resuming previous session...');
          }
          localStorage.removeItem('zen_live_session');
        }
      } catch (e) {
        console.warn('Failed to check session resumption:', e);
      }

      // 3. Setup Playback Context (Shared Singleton)
      // Use getSharedAudioContext to prevent browser resource exhaustion
      const audioContext = getSharedAudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;
      // Best-effort: encourage speaker output on mobile when mic is active.
      await ensureMobileSpeakerOutput(audioContext);

      // 4. Setup Input Stream (16kHz)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true
        }
      });
      streamRef.current = stream;

      // CHECK ABORT
      if (abortController.signal.aborted) {
        throw new DOMException('Connection aborted by user', 'AbortError');
      }

      // 5. Initiate Gemini Live Connection with enhanced config
      const sessionPromise = ai.live.connect({
        model: MODEL_LIVE,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          systemInstruction: systemContext,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Extended tools for live mode (including voice-specific activity tools)
          tools: [{
            functionDeclarations: [
              renderUIFunction,
              calendarFunction,
              getEventsFunction,
              startGuidedActivityFunction,
              controlActivityFunction,
              voiceFeedbackFunction
            ]
          }],
          ...resumptionConfig
        },
        callbacks: {
          onopen: () => {
            console.log("Live Session Opened");
            setStatus(LiveStatus.CONNECTED);
            isSessionReadyRef.current = true;

            // Store session reference for GuidanceExecutor
            sessionPromise.then(sess => {
              sessionRef.current = sess;
              console.log('LiveSession: Session reference stored for guidance');

              // Check for saved guidance state from disconnect (localStorage + Supabase)
              // Load state asynchronously and process when ready
              (async () => {
                let savedGuidanceState = null;
                let savedExecutorState = null;

                try {
                  // const { loadGuidanceState, loadGuidanceExecutorState } = await import('../services/persistenceService'); // Using static import
                  savedGuidanceState = await loadGuidanceState(userId || undefined, activeWorkoutMessageId || undefined);
                  savedExecutorState = loadGuidanceExecutorState();
                } catch (e) {
                  console.warn('Failed to load guidance state:', e);
                }

                // Process saved state if found
                if (savedGuidanceState || savedExecutorState) {
                  const savedType = savedGuidanceState?.activityType;
                  const hasSavedMindful =
                    savedGuidanceState &&
                    (savedType === 'breathing' || savedType === 'meditation' || savedType === 'timer') &&
                    savedGuidanceState.status !== 'completed';

                  if (hasSavedMindful) {
                    const contextTimer = contextRef.current?.activeTimer;
                    if (!lastTimerRef.current) {
                      const restoredLabel = contextTimer?.label || (savedType === 'breathing' ? 'Breathing Practice' : 'Guided Meditation');
                      const restoredDuration = contextTimer?.totalSeconds || 300;
                      const restoredConfig: any = {
                        duration: restoredDuration,
                        durationMinutes: Math.max(1, Math.floor(restoredDuration / 60)),
                        label: restoredLabel,
                        guidanceStyle: 'light',
                        intent: savedType === 'breathing' ? 'breathing_reset' : 'deep_meditation'
                      };
                      if (savedType === 'breathing') {
                        restoredConfig.pattern = { name: 'box', cycles: Math.max(1, Math.floor(restoredDuration / 60)) };
                      }
                      lastTimerRef.current = {
                        label: restoredLabel,
                        duration: restoredDuration,
                        activityType: savedType as string,
                        config: restoredConfig,
                        timestamp: Date.now()
                      };
                      saveWorkoutRefs({
                        workoutListsMap: Array.from(workoutListsMapRef.current.entries()),
                        lastWorkoutList: lastWorkoutListRef.current,
                        lastTimer: lastTimerRef.current
                      });
                    }

                    clearAutoReconnectState();
                    setTimeout(() => {
                      if (sess && isSessionReadyRef.current) {
                        const remaining = contextTimer?.remainingSeconds;
                        const remainingText = typeof remaining === 'number'
                          ? ` with about ${Math.max(1, Math.round(remaining / 60))} minute${Math.max(1, Math.round(remaining / 60)) === 1 ? '' : 's'} left`
                          : '';
                        const resumePrompt = `[SYSTEM NOTE: The user was disconnected during a ${savedType} session${remainingText}. Briefly acknowledge reconnection and ask if they'd like to resume now.]`;
                        sess.sendClientContent({
                          turns: [{ role: 'user', parts: [{ text: resumePrompt }] }],
                          turnComplete: true
                        });
                      }
                    }, 1500);
                  }

                  // Check for resumable workout from context or saved state
                  const context = contextRef.current;
                  // Handle both workout progress formats: with exercises array or summary format
                  const contextWorkout = context?.currentWorkoutProgress as any;
                  const hasContextWorkout = contextWorkout && (
                    (contextWorkout.exercises && Array.isArray(contextWorkout.exercises) && contextWorkout.exercises.length > 0) ||
                    (contextWorkout.totalExercises && contextWorkout.totalExercises > 0)
                  );
                  const hasSavedGuidance = savedGuidanceState &&
                    (savedGuidanceState.activityType === 'workout' || savedGuidanceState.activityType === 'stretching');

                  if (hasContextWorkout || hasSavedGuidance) {
                    // Create progress object - handle both formats
                    const progress: any = contextWorkout || {
                      title: 'Previous Workout',
                      exercises: Array(savedGuidanceState?.totalExercises || 0).fill({ completed: false }).map((_, i) => ({
                        completed: savedGuidanceState?.completedExercises?.length > i
                      }))
                    };

                    // Calculate completed count - handle both formats
                    const completedCount = hasSavedGuidance
                      ? (savedGuidanceState.completedExercises?.length || savedGuidanceState.currentExerciseIndex || 0)
                      : progress.exercises
                        ? progress.exercises.filter((e: any) => e.completed).length
                        : (progress.completedCount || 0);
                    const totalCount = hasSavedGuidance
                      ? savedGuidanceState.totalExercises
                      : (progress.exercises?.length || progress.totalExercises || 0);

                    if (completedCount < totalCount && completedCount > 0) {
                      // There's a workout in progress - offer to resume
                      console.log(`LiveSession: Found resumable workout - ${completedCount}/${totalCount} completed`);

                      // import('../services/persistenceService').then(({ clearAutoReconnectState }) => { // Using static import
                      clearAutoReconnectState();
                      // }).catch(e => console.warn('Failed to clear auto-reconnect state:', e));
                      setTimeout(() => {
                        if (sess && isSessionReadyRef.current) {
                          const wasDisconnected = hasSavedGuidance && savedGuidanceState.status !== 'completed';
                          const isStretching = savedGuidanceState?.activityType === 'stretching';
                          const sessionLabel = isStretching ? 'stretching session' : 'workout';
                          const resumePrompt = wasDisconnected
                            ? `[SYSTEM NOTE: The user was disconnected during their ${sessionLabel} "${progress.title || (isStretching ? 'Stretching Session' : 'Workout')}" with ${completedCount}/${totalCount} exercises completed. Briefly acknowledge the reconnection and ask if they'd like to resume from exercise ${completedCount + 1} or start fresh.]`
                            : `[SYSTEM NOTE: The user has an in-progress ${sessionLabel} "${progress.title}" with ${completedCount}/${totalCount} exercises completed. Ask if they'd like to resume or start fresh.]`;
                          sess.sendClientContent({
                            turns: [{ role: 'user', parts: [{ text: resumePrompt }] }],
                            turnComplete: true
                          });

                          // Note: Don't clear state here - let user decide to resume or start fresh
                          // State will be cleared on successful completion
                        }
                      }, 1500); // Delay to let audio setup complete
                    }
                  }
                }
              })();
            });

            // Start Audio Processing
            (async () => {
              try {
                const inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                inputContextRef.current = inputContext;

                const blob = new Blob([AUDIO_WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
                const workletUrl = URL.createObjectURL(blob);
                await inputContext.audioWorklet.addModule(workletUrl);

                const source = inputContext.createMediaStreamSource(stream);
                const workletNode = new AudioWorkletNode(inputContext, 'pcm-processor');

                workletNode.port.onmessage = (e) => {
                  // Check both connected and session ready before processing
                  if (!isConnectedRef.current || !isSessionReadyRef.current) return;

                  const inputData = e.data as Float32Array;

                  // Update audio quality metrics
                  audioQualityRef.current = analyzeAudioQuality(audioQualityRef.current, inputData);

                  // Visualizer callback
                  if (onAudioDataRef.current) onAudioDataRef.current(inputData);

                  // Send to Gemini (if not muted and not paused)
                  if (!isMutedRef.current && !isPausedRef.current && isSessionReadyRef.current) {
                    const pcmBlob = createPcmBlob(inputData);
                    sessionPromise.then(sess => {
                      // Double-check session is still ready before sending
                      if (isConnectedRef.current && isSessionReadyRef.current && sessionRef.current) {
                        try {
                          // Check if session has a way to verify WebSocket state before sending
                          // This prevents errors when WebSocket is already closing/closed
                          sess.sendRealtimeInput({ media: pcmBlob });
                        } catch (err: any) {
                          const msg = typeof err?.message === 'string' ? err.message : '';
                          const errStr = String(err);

                          // If WS is closing/closed, handle gracefully
                          if (/CLOSING|CLOSED|WebSocket.*CLOS/i.test(msg) || /CLOSING|CLOSED|WebSocket.*CLOS/i.test(errStr)) {
                            // Only handle once to prevent multiple disconnect calls
                            if (!wsClosingHandledRef.current) {
                              wsClosingHandledRef.current = true;
                              isSessionReadyRef.current = false;

                              // If guidance is active, we need to reconnect to continue
                              const executor = getGuidanceExecutor();
                              const progress = executor.getProgress();
                              const hasActiveGuidance = progress.status === 'active' || progress.status === 'paused';

                              if (!manualDisconnectRef.current) {
                                // If guidance is active, attempt reconnection
                                if (hasActiveGuidance) {
                                  console.log('LiveSession: WebSocket closed during active guidance - will reconnect');
                                  // Pause guidance temporarily
                                  if (progress.status === 'active') {
                                    executor.pause();
                                  }
                                }
                                // Disconnect and let reconnection logic handle it
                                setTimeout(() => disconnect(false), 0);
                              }
                            }
                            // Silently skip - error already handled
                            return;
                          }
                          // For other errors, log but don't break
                          console.debug('Audio send error:', err);
                        }
                      }
                    }).catch(() => {
                      // Session promise rejected, connection is gone
                      // Silently handle - connection will be re-established if needed
                    });
                  }
                };

                source.connect(workletNode);
                workletNode.connect(inputContext.destination);

                inputSourceRef.current = source;
                workletNodeRef.current = workletNode;

              } catch (err) {
                console.error("Audio Worklet Error:", err);
                if (onErrorRef.current) onErrorRef.current('AUDIO_SETUP', 'Failed to initialize microphone');
                disconnect(false);
              }
            })();
          },
          onmessage: (msg: LiveServerMessage) => {
            if (!isConnectedRef.current) return;

            // Handle async operations inside the callback
            (async () => {
              try {
                // Track turn count
                if (msg.serverContent?.turnComplete) {
                  sessionStateRef.current.turnCount++;

                  // Check if context refresh needed
                  const contextNeedsRefresh = shouldRefreshContext({
                    ...contextRef.current,
                    conversationTurnCount: sessionStateRef.current.turnCount,
                    lastContextRefresh: sessionStateRef.current.lastRefresh
                  });

                  if (contextNeedsRefresh && getContextRef.current) {
                    // Refresh context in background
                    getContextRef.current().then(ctx => {
                      contextRef.current = updateContext(contextRef.current, ctx);
                      sessionStateRef.current.lastRefresh = Date.now();
                    }).catch(console.warn);
                  }
                }

                // Handle session resumption updates
                if ((msg as any).sessionResumptionUpdate?.newHandle) {
                  sessionStateRef.current.resumptionToken = (msg as any).sessionResumptionUpdate.newHandle;
                }

                // 1. Tool Calls
                if (msg.toolCall) {
                  setIsProcessing(false); // Server responded with tool call
                  for (const fc of msg.toolCall.functionCalls) {
                    if (fc.name === 'renderUI') {
                      const args = fc.args as any;

                      if (args && args.type && args.props && validateUIComponent(args.type, args.props)) {
                        // Process tool through middleware (enhances props, generates voice options)
                        const toolResult = processToolInterceptors('renderUI', args);
                        let enhancedProps = toolResult.props;
                        // Normalize timer duration so "1 min" requests don't show 5:00
                        if (args.type === 'timer') {
                          enhancedProps = normalizeTimerProps(enhancedProps, lastUserMessageRef.current);
                        }
                        if (args.type === 'workoutList' && enhancedProps?.exercises) {
                          try {
                            const pool = await getExercisePool();
                            const normalizedWorkout = composePhysicalWorkoutFromRequest({
                              title: enhancedProps.title,
                              exercises: enhancedProps.exercises,
                              durationMinutes: typeof enhancedProps.durationMinutes === 'number' ? enhancedProps.durationMinutes : undefined,
                              focus: lastUserMessageRef.current
                            }, pool, {
                              healthConditions: contextRef.current?.onboardingState?.healthConditions || []
                            });
                            enhancedProps = {
                              ...enhancedProps,
                              ...normalizedWorkout
                            };
                          } catch (e) {
                            console.warn('LiveSession: Failed to normalize workoutList from exercise DB:', e);
                          }
                        }
                        const voiceOptions = toolResult.voiceOptions;

                        if (toolResult.wasEnhanced) {
                          console.log('LiveSession: Auto-generated voice options for', args.type, voiceOptions?.length, 'options');
                        }

                        // Activate selection mode if we have voice options
                        if (voiceOptions && Array.isArray(voiceOptions) && voiceOptions.length > 0) {
                          console.log('LiveSession: Active selection mode enabled with options:', voiceOptions);
                          activeSelectionRef.current = voiceOptions;

                          // Set timeout to clear selection mode if no input
                          if (selectionModeTimeoutRef.current) clearTimeout(selectionModeTimeoutRef.current);
                          selectionModeTimeoutRef.current = setTimeout(() => {
                            if (activeSelectionRef.current.length > 0) {
                              console.log('LiveSession: Selection mode timed out');
                              activeSelectionRef.current = [];
                              if (onErrorRef.current) onErrorRef.current('TIMEOUT', generateErrorPrompt('TIMEOUT'));
                            }
                          }, 30000); // 30s timeout
                        }

                        // Track workoutList for auto-start detection and dynamic updates
                        if (args.type === 'workoutList' && enhancedProps?.exercises) {
                          const workoutData = {
                            exercises: enhancedProps.exercises,
                            title: enhancedProps.title || 'Workout',
                            timestamp: Date.now()
                          };

                          // Store in map by a temporary ID (will be updated when message ID is known)
                          // Use timestamp as temporary key
                          const tempId = `temp_${Date.now()}`;
                          workoutListsMapRef.current.set(tempId, workoutData);

                          lastWorkoutListRef.current = {
                            ...workoutData,
                            messageId: tempId
                          };

                          // Save workout refs to persistence service
                          // import('../services/persistenceService').then(({ saveWorkoutRefs }) => { // Using static import
                          saveWorkoutRefs({
                            workoutListsMap: Array.from(workoutListsMapRef.current.entries()),
                            lastWorkoutList: lastWorkoutListRef.current,
                            lastTimer: lastTimerRef.current
                          });
                          // }).catch(e => console.warn('Failed to save workout refs:', e));

                          // Note: workoutListMessageId will be set when the message is created in App.tsx
                          // We'll track it via onToolCall callback
                          console.log('LiveSession: Tracked workoutList for auto-start detection');
                        }

                        // Track timer for auto-start detection
                        if (args.type === 'timer' && enhancedProps) {
                          const mindful = buildMindfulTimerActivity(enhancedProps);

                          if (mindful) {
                            lastTimerRef.current = {
                              label: mindful.config.label,
                              duration: mindful.config.duration,
                              activityType: mindful.activityType,
                              config: mindful.config,
                              timestamp: Date.now()
                            };

                            saveWorkoutRefs({
                              workoutListsMap: Array.from(workoutListsMapRef.current.entries()),
                              lastWorkoutList: lastWorkoutListRef.current,
                              lastTimer: lastTimerRef.current
                            });

                            console.log('LiveSession: Tracked timer for auto-start detection:', mindful.activityType);
                          }
                        }

                        if (onToolCallRef.current) {
                          onToolCallRef.current({
                            type: args.type,
                            props: enhancedProps,
                            voiceOptions: activeSelectionRef.current.length > 0 ? activeSelectionRef.current : undefined
                          });
                        }
                      } else {
                        console.warn(`LiveSession: Rejecting invalid UI component '${args?.type}'`);
                        // Provide verbal fallback
                        if (onErrorRef.current) {
                          const fallback = generateVerbalFallback('renderUI', args);
                          onErrorRef.current('TOOL_FAILURE', fallback);
                        }
                      }

                      sessionPromise.then(sess => {
                        if (isConnectedRef.current) {
                          sess.sendToolResponse({
                            functionResponses: [{
                              id: fc.id,
                              name: fc.name,
                              response: { result: "UI Rendered" }
                            }]
                          });
                        }
                      });
                    }

                    // Handle guided activity start
                    else if (fc.name === 'startGuidedActivity') {
                      const args = fc.args as any;
                      const activityType = args.activityType as string;

                      if (activityType === 'breathing' || activityType === 'meditation' || activityType === 'timer') {
                        startGuidanceForTimer(activityType, args);
                        sessionPromise.then(sess => {
                          if (isConnectedRef.current) {
                            sess.sendToolResponse({
                              functionResponses: [{
                                id: fc.id,
                                name: fc.name,
                                response: { result: `Started ${activityType} activity` }
                              }]
                            });
                          }
                        });
                        continue;
                      }

                      const physicalType = args.activityType === 'stretching' ? 'stretching' : 'workout';
                      const now = Date.now();
                      const activeWorkoutFromMap =
                        activeWorkoutMessageId &&
                        workoutListsMapRef.current.has(activeWorkoutMessageId)
                          ? workoutListsMapRef.current.get(activeWorkoutMessageId)
                          : null;
                      const recentActiveWorkout =
                        activeWorkoutFromMap && now - activeWorkoutFromMap.timestamp < 90_000
                          ? activeWorkoutFromMap
                          : null;
                      const fallbackWorkout =
                        lastWorkoutListRef.current && now - lastWorkoutListRef.current.timestamp < 90_000
                          ? lastWorkoutListRef.current
                          : null;
                      const requestedExercises = Array.isArray(args.exercises) ? args.exercises : [];
                      const sourceExercises =
                        requestedExercises.length > 0
                          ? requestedExercises
                          : recentActiveWorkout?.exercises || fallbackWorkout?.exercises || [];
                      const sourceTitle =
                        args.title ||
                        recentActiveWorkout?.title ||
                        fallbackWorkout?.title ||
                        (physicalType === 'stretching' ? 'Stretching Session' : 'Workout Session');

                      if (!Array.isArray(sourceExercises) || sourceExercises.length === 0) {
                        if (onVoiceCommandRef.current) {
                          onVoiceCommandRef.current(
                            'CLARIFICATION',
                            "I can start as soon as your workout list is ready. I'll generate the list first."
                          );
                        }
                        sessionPromise.then(sess => {
                          if (isConnectedRef.current) {
                            sess.sendToolResponse({
                              functionResponses: [{
                                id: fc.id,
                                name: fc.name,
                                response: { result: 'Skipped startGuidedActivity: no workout exercises available yet.' }
                              }]
                            });
                          }
                        });
                        continue;
                      }

                      let normalizedPhysical = {
                        title: sourceTitle,
                        exercises: sourceExercises
                      };
                      try {
                        const pool = await getExercisePool();
                        const composed = composePhysicalWorkoutFromRequest({
                          title: normalizedPhysical.title,
                          exercises: normalizedPhysical.exercises,
                          durationMinutes: typeof args.durationMinutes === 'number' ? args.durationMinutes : undefined,
                          focus: lastUserMessageRef.current
                        }, pool, {
                          healthConditions: contextRef.current?.onboardingState?.healthConditions || []
                        });
                        normalizedPhysical = {
                          title: composed.title,
                          exercises: composed.exercises
                        };
                      } catch (e) {
                        console.warn('LiveSession: Failed to normalize startGuidedActivity workout from exercise DB:', e);
                      }
                      startGuidanceForWorkout(physicalType, {
                        title: normalizedPhysical.title,
                        exercises: normalizedPhysical.exercises
                      });

                      sessionPromise.then(sess => {
                        if (isConnectedRef.current) {
                          sess.sendToolResponse({
                            functionResponses: [{
                              id: fc.id,
                              name: fc.name,
                              response: { result: `Started ${args.activityType} activity with ${normalizedPhysical.exercises?.length || 0} exercises` }
                            }]
                          });
                        }
                      });
                    }

                    // Handle activity control
                    else if (fc.name === 'controlActivity') {
                      const args = fc.args as any;
                      const action = args.action as string;
                      const executor = getGuidanceExecutor();

                      // Map to guidance executor and parent control
                      if (action === 'pause') {
                        executor.pause();
                        if (onActivityControlRef.current) onActivityControlRef.current('pause');
                      } else if (action === 'resume') {
                        executor.resume();
                        if (onActivityControlRef.current) onActivityControlRef.current('resume');
                      } else if (action === 'skip') {
                        executor.skip();
                      } else if (action === 'stop') {
                        executor.stop();
                        stopGuidanceKeepalive();
                        if (onActivityControlRef.current) onActivityControlRef.current('stop');
                      } else if (action === 'back') {
                        executor.goBack();
                      }

                      // Handle pace changes
                      if (action === 'slower') {
                        executor.adjustPace('slow');
                        const newPace = adjustPace(paceState, 'SLOW_PACE');
                        setPaceState(newPace);
                        if (onPaceChangeRef.current) onPaceChangeRef.current(newPace);
                      } else if (action === 'faster') {
                        executor.adjustPace('fast');
                        const newPace = adjustPace(paceState, 'SPEED_PACE');
                        setPaceState(newPace);
                        if (onPaceChangeRef.current) onPaceChangeRef.current(newPace);
                      }

                      sessionPromise.then(sess => {
                        if (isConnectedRef.current) {
                          sess.sendToolResponse({
                            functionResponses: [{
                              id: fc.id,
                              name: fc.name,
                              response: { result: `Activity ${action} executed` }
                            }]
                          });
                        }
                      });
                    }

                    // Handle voice feedback (just acknowledge)
                    else if (fc.name === 'provideVoiceFeedback') {
                      sessionPromise.then(sess => {
                        if (isConnectedRef.current) {
                          sess.sendToolResponse({
                            functionResponses: [{
                              id: fc.id,
                              name: fc.name,
                              response: { result: "Feedback provided" }
                            }]
                          });
                        }
                      });
                    }

                    // Handle Calendar: Create Event
                    else if (fc.name === 'createCalendarEvent') {
                      const args = fc.args as any;
                      const start = new Date(args.scheduledTime);
                      createCalendarEvent({
                        summary: args.title,
                        start,
                        durationMinutes: args.durationMinutes || 30,
                        description: args.description
                      }, accessToken).then(result => {
                        if (result && userId) {
                          createScheduledEvent(userId, {
                            eventType: 'workout',
                            title: result.summary,
                            scheduledAt: start.toISOString(),
                            googleEventId: result.id
                          }).catch(console.error);
                        }
                        sessionPromise.then(sess => {
                          if (isConnectedRef.current) {
                            sess.sendToolResponse({
                              functionResponses: [{
                                id: fc.id,
                                name: fc.name,
                                response: { result: result ? `Event created: ${result.summary}` : "Failed to create event" }
                              }]
                            });
                          }
                        });
                      });
                    }

                    // Handle Calendar: Get Events
                    else if (fc.name === 'getUpcomingEvents') {
                      const args = fc.args as any;
                      getUpcomingEvents(args.maxResults || 5, accessToken).then(events => {
                        const eventList = events.map(e =>
                          `${e.summary} at ${e.start.dateTime ? new Date(e.start.dateTime).toLocaleString() : e.start.date}`
                        ).join('\n');

                        sessionPromise.then(sess => {
                          if (isConnectedRef.current) {
                            sess.sendToolResponse({
                              functionResponses: [{
                                id: fc.id,
                                name: fc.name,
                                response: { result: eventList || "No upcoming events found." }
                              }]
                            });
                          }
                        });
                      });
                    }
                  }
                }

                // 2. Transcriptions with voice command detection and memory buffering
                if (msg.serverContent?.inputTranscription?.text) {
                  const transcript = msg.serverContent.inputTranscription.text;
                  const isFinal = !!msg.serverContent?.turnComplete;
                  // If user turn is complete, we are now processing
                  if (isFinal) {
                    setIsProcessing(true);
                    if (transcript.trim()) lastUserMessageRef.current = transcript;
                  }

                  // Buffer transcript for session summary
                  bufferTranscript({
                    text: transcript,
                    isUser: true,
                    timestamp: Date.now(),
                    isFinal
                  });
                  if (isFinal && liveSessionMetaRef.current) {
                    liveSessionMetaRef.current.userMessageCount += 1;
                    liveSessionMetaRef.current.lastUserMessage = transcript;
                  }

                  // Check for voice commands first
                  const commandHandled = handleVoiceCommand(transcript);

                  // Always pass transcription to parent (for chat display)
                  if (onTranscriptionRef.current) {
                    onTranscriptionRef.current(transcript, true, false);
                  }

                  // Reset clarification on valid input
                  if (transcript.length > 3) {
                    clarificationRef.current = resetClarification(clarificationRef.current);
                  }

                  // Mid-session memory extraction (async, non-blocking)
                  if (userId && isFinal && transcript.length > 15) {
                    extractFromTranscription(userId, {
                      text: transcript,
                      isUser: true,
                      timestamp: Date.now(),
                      isFinal: true
                    }).then(extracted => {
                      if (extracted && onMemoryExtractedRef.current) {
                        onMemoryExtractedRef.current(extracted.content, extracted.type);
                      }
                    }).catch(console.warn);
                  }
                }

                if (msg.serverContent?.turnComplete) {
                  if (onTranscriptionRef.current) {
                    onTranscriptionRef.current("", true, true);
                  }
                }

                if (msg.serverContent?.outputTranscription?.text) {
                  setIsProcessing(false); // Server started sending text
                  const rawAiText = msg.serverContent.outputTranscription.text;
                  // Strip leaked [SPEAK] markers and low-level control tokens like <ctrl46>
                  // so they never appear in chat or guidance UI.
                  const aiText = rawAiText
                    .replace(/\[SPEAK\]\s*:\s*/gi, '')
                    .replace(/\[SPEAK\]\s*/gi, '')
                    .replace(/<ctrl\d+>/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                  if (aiText) {
                    if (onTranscriptionRef.current) {
                      onTranscriptionRef.current(aiText, false, false);
                    }

                    // Buffer AI transcripts too
                    bufferTranscript({
                      text: aiText,
                      isUser: false,
                      timestamp: Date.now(),
                      isFinal: true
                    });
                    if (liveSessionMetaRef.current) {
                      liveSessionMetaRef.current.aiMessageCount += 1;
                      liveSessionMetaRef.current.lastAiMessage = aiText;
                    }
                  }
                }

                // 3. Audio Output (skip if muted) - handle async inside IIFE
                const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) setIsProcessing(false); // Server started sending audio
                if (base64Audio && audioContextRef.current && !isMuted) {
                  (async () => {
                    const ctx = audioContextRef.current!;
                    // If audio becomes suspended (autoplay/tab), resume before playback.
                    if (ctx.state === 'suspended') {
                      try { await ctx.resume(); } catch (_) { /* ignore */ }
                    }
                    const audioData = base64ToUint8Array(base64Audio);
                    const audioBuffer = await decodeAudioData(audioData, ctx, 24000);

                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    // Route through media element on mobile if available; otherwise direct to speakers.
                    const outputNode =
                      (useMediaElementOutputRef.current && outputStreamDestRef.current)
                        ? outputStreamDestRef.current
                        : ctx.destination;
                    source.connect(outputNode);

                    const currentTime = ctx.currentTime;
                    if (nextStartTimeRef.current < currentTime) {
                      nextStartTimeRef.current = currentTime;
                    }

                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;

                    sourcesRef.current.add(source);
                    setIsSpeaking(true); // Audio started

                    source.onended = () => {
                      sourcesRef.current.delete(source);
                      if (sourcesRef.current.size === 0) {
                        setIsSpeaking(false); // Audio ended
                      }
                    };
                  })();
                }

                // 4. Interruption
                if (msg.serverContent?.interrupted) {
                  sourcesRef.current.forEach(s => s.stop());
                  sourcesRef.current.clear();
                  setIsSpeaking(false); // Interrupted
                  nextStartTimeRef.current = 0;
                  if (onInterruptionRef.current) onInterruptionRef.current();
                }

              } catch (err) {
                console.error("Error processing message:", err);
              }
            })();
          },

          onclose: () => {
            console.log("Live Session Closed by Server");
            isSessionReadyRef.current = false; // Stop audio sending immediately
            setIsProcessing(false); // Reset processing state

            // Stop keepalive on disconnect
            stopGuidanceKeepalive();

            // Pause guidance if active during unexpected disconnect
            const executor = getGuidanceExecutor();
            const progress = executor.getProgress();
            if (progress.status === 'active' || progress.status === 'paused') {
              console.log('LiveSession: Pausing guidance due to disconnection');
              executor.pause();
              // Reset guidance state flags since session is disconnected
              isGuidanceActiveRef.current = false;
              isExpectingGuidanceResponseRef.current = false;
            }

            // Only attempt reconnection if this was unexpected (not user-initiated)
            if (isConnectedRef.current && !manualDisconnectRef.current) {
              console.log("Unexpected disconnection detected - attempting auto-reconnect");
              setStatus(LiveStatus.RECONNECTING);
              if (onReconnectingRef.current) onReconnectingRef.current();
              if (onErrorRef.current) onErrorRef.current('CONNECTION_LOST', 'Connection interrupted. Reconnecting...');

              // Attempt auto-reconnect with exponential backoff
              const attemptReconnect = async (attempt: number = 1, maxAttempts: number = 3) => {
                if (!isConnectedRef.current) {
                  // User initiated disconnect during reconnect attempts
                  return;
                }

                const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                console.log(`Reconnection attempt ${attempt}/${maxAttempts} in ${backoffDelay}ms`);

                await new Promise(resolve => setTimeout(resolve, backoffDelay));

                if (!isConnectedRef.current) return; // Check again after delay

                try {
                  // Reset session ready state for reconnection
                  isSessionReadyRef.current = false;

                  // Try to reconnect using stored resumption token
                  const savedSession = localStorage.getItem('zen_live_session');
                  if (savedSession) {
                    const parsed = JSON.parse(savedSession);
                    // Only use token if recent (within 5 minutes)
                    if (Date.now() - parsed.timestamp < 5 * 60 * 1000 && parsed.token) {
                      console.log('Using saved resumption token for reconnection');
                      // The connect function will use the saved token
                    }
                  }

                  // Trigger a reconnect by calling connect again
                  // Note: This will be handled by the calling component
                  setStatus(LiveStatus.DISCONNECTED);
                  isConnectedRef.current = false;

                  // Notify that we're ready for manual reconnect
                  if (onErrorRef.current) {
                    if (attempt < maxAttempts) {
                      onErrorRef.current('RECONNECT_FAILED', `Reconnection attempt ${attempt} failed. Retrying...`);
                      attemptReconnect(attempt + 1, maxAttempts);
                    } else {
                      onErrorRef.current('RECONNECT_FAILED', 'Unable to reconnect. Please try again manually.');
                      disconnect(false);
                    }
                  }
                } catch (e) {
                  console.error('Reconnection error:', e);
                  if (attempt < maxAttempts) {
                    attemptReconnect(attempt + 1, maxAttempts);
                  } else {
                    disconnect(false);
                  }
                }
              };

              attemptReconnect();
            } else {
              // Normal disconnection
              disconnect(false);
            }
          },

          onerror: (err) => {
            console.error("Live Session Error:", err);
            setIsProcessing(false); // Reset on error
            if (onErrorRef.current) onErrorRef.current('CONNECTION_ERROR', 'Voice connection error occurred');
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error("Connection Failed:", e);
      let errorMsg = 'Failed to start Live session. Please try again.';
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        errorMsg = 'Microphone access denied. Please allow microphone access.';
        if (onErrorRef.current) onErrorRef.current('PERMISSION_DENIED', errorMsg);
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        errorMsg = 'No microphone found. Please check your input devices.';
        if (onErrorRef.current) onErrorRef.current('NO_DEVICE', errorMsg);
      } else {
        if (onErrorRef.current) onErrorRef.current('CONNECTION_FAILED', errorMsg);
      }
      setErrorMessage(errorMsg);
      setStatus(LiveStatus.DISCONNECTED);
      setIsProcessing(false);
      isConnectedRef.current = false;
    }
  }, [
    disconnect,
    conversationHistory,
    status
  ]);

  // Store connect function in ref for access from other callbacks that are defined earlier
  useEffect(() => {
    connectFnRef.current = connect;
  }, [connect]);

  // ──────────────────────────────────────────────────────────────────────────
  // CLEANUP ON UNMOUNT
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (isConnectedRef.current) {
        disconnect(false);
      }
    };
  }, [disconnect]);

  // Handle Page Visibility for Robust Persistence
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // If we have active guidance, do a strict save
        if (isGuidanceActiveRef.current && sessionRef.current) {
          console.log('Page hidden - triggering backup save');
          const executor = getGuidanceExecutor();
          const progress = executor.getProgress();
          // Sync backup
          try {
            const minimalState = {
              activityType: progress.activityType,
              currentExerciseIndex: progress.currentExerciseIndex,
              timestamp: Date.now(),
              backup: true
            };
            localStorage.setItem('zen_guidance_visibility_backup', JSON.stringify(minimalState));
          } catch (e) { }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // SEND MESSAGE TO LIVE MODE
  // ──────────────────────────────────────────────────────────────────────────

  const sendMessageToLive = useCallback((messageText: string) => {
    lastUserMessageRef.current = messageText;
    if (sessionRef.current && isConnectedRef.current && isSessionReadyRef.current) {
      try {
        sessionRef.current.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: messageText }]
          }],
          turnComplete: true // Allow Gemini to process and respond naturally
        });
        console.log('LiveSession: Sent message to Live Mode:', messageText.substring(0, 50));
      } catch (error) {
        console.error('LiveSession: Failed to send message to Live Mode:', error);
        if (onErrorRef.current) {
          onErrorRef.current('SEND_MESSAGE_FAILED', 'Failed to send message to voice session');
        }
      }
    } else {
      console.warn('LiveSession: Cannot send message - session not ready');
      if (onErrorRef.current) {
        onErrorRef.current('SESSION_NOT_READY', 'Voice session is not connected yet');
      }
    }
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // GUIDANCE CONTROL FUNCTIONS (defined before return for scope)
  // ──────────────────────────────────────────────────────────────────────────

  const resumeGuidance = useCallback(() => {
    if (guidanceExecutorRef.current) {
      const progress = guidanceExecutorRef.current.getProgress();

      // Check if session is connected before resuming
      if (!isConnectedRef.current || !isSessionReadyRef.current) {
        console.warn('LiveSession: Cannot resume guidance - session not connected. Attempting to reconnect...');
        // Attempt to reconnect if not already connecting
        if (status !== LiveStatus.CONNECTING && status !== LiveStatus.RECONNECTING && connectFnRef.current) {
          connectFnRef.current().then(() => {
            // Retry resume after connection is established
            setTimeout(() => {
              if (guidanceExecutorRef.current) {
                const exec = guidanceExecutorRef.current;
                const prog = exec.getProgress();
                if (prog.status === 'paused' && isConnectedRef.current && isSessionReadyRef.current) {
                  exec.resume();
                  isGuidanceActiveRef.current = true;
                  isExpectingGuidanceResponseRef.current = true;
                  lastGuidanceCueTimeRef.current = Date.now();
                  startGuidanceKeepalive();
                  console.log('LiveSession: Resumed guidance executor after reconnection');
                }
              }
            }, 500);
          }).catch(err => {
            console.error('LiveSession: Failed to reconnect for guidance resume:', err);
          });
        }
        return;
      }

      if (progress.status === 'paused') {
        guidanceExecutorRef.current.resume();
        isGuidanceActiveRef.current = true;
        isExpectingGuidanceResponseRef.current = true;
        lastGuidanceCueTimeRef.current = Date.now();
        startGuidanceKeepalive();
        console.log('LiveSession: Resumed guidance executor');
      } else if (progress.status === 'idle') {
        // Guidance not started yet, start it
        guidanceExecutorRef.current.start();
        isGuidanceActiveRef.current = true;
        isExpectingGuidanceResponseRef.current = true;
        lastGuidanceCueTimeRef.current = Date.now();
        startGuidanceKeepalive();
        console.log('LiveSession: Started guidance executor');
      }
    }
  }, [status, connect]);

  const startGuidanceForWorkout = useCallback((
    activityType: 'workout' | 'stretching',
    workout: { title: string; exercises: any[] },
    options?: { attemptRestoreDetailedState?: boolean }
  ) => {
    const executor = getGuidanceExecutor();
    const progress = executor.getProgress();
    guidanceExecutorRef.current = executor;

    if (progress.status === 'active' && progress.activityType === activityType) {
      return;
    }

    if (progress.status === 'paused' && progress.activityType === activityType) {
      resumeGuidance();
      return;
    }

    if (progress.status !== 'idle') {
      executor.stop();
    }

    const normalizedWorkout = {
      title: workout.title || (activityType === 'stretching' ? 'Stretching' : 'Workout'),
      exercises: Array.isArray(workout.exercises) ? workout.exercises : []
    };

    if (normalizedWorkout.exercises.length === 0) {
      return;
    }

    lastWorkoutListRef.current = {
      exercises: normalizedWorkout.exercises,
      title: normalizedWorkout.title,
      timestamp: Date.now(),
      messageId: lastWorkoutListRef.current?.messageId
    };

    const config = createGuidanceConfig(activityType, {
      title: normalizedWorkout.title,
      exercises: normalizedWorkout.exercises,
      pace: 'normal'
    });

    executor.initialize(config, {
      onCue: (cue, text) => {
        console.log(`GuidanceCue [${cue.type}]:`, text);
        sendGuidanceCueToGemini(text, cue.type);
      },
      onExerciseStart: (name, index) => {
        console.log(`Exercise started: ${name} (${index + 1}/${normalizedWorkout.exercises.length || '?'})`);
        const completedExercises = normalizedWorkout.exercises.slice(0, index).map((e: any) => e.name);
        if (onGuidedActivityStartRef.current) {
          const completedExerciseIndices = Array.from({ length: index }, (_, i) => i);
          onGuidedActivityStartRef.current(activityType, {
            title: normalizedWorkout.title,
            exercises: normalizedWorkout.exercises,
            currentExerciseIndex: index,
            completedExercises,
            completedExerciseIndices,
            isTimerRunning: false
          });
        }
      },
      onExerciseComplete: (name, index) => {
        console.log(`Exercise complete: ${name} (${index + 1}/${normalizedWorkout.exercises.length || '?'})`);
        const completedExercises = normalizedWorkout.exercises.slice(0, index + 1).map((e: any) => e.name);
        if (onGuidedActivityStartRef.current) {
          const completedExerciseIndices = Array.from({ length: index + 1 }, (_, i) => i);
          onGuidedActivityStartRef.current(activityType, {
            title: normalizedWorkout.title,
            exercises: normalizedWorkout.exercises,
            currentExerciseIndex: index + 1,
            completedExercises,
            completedExerciseIndices,
            isTimerRunning: false
          });
        }
      },
      onTimerControl: (action, exerciseIndex, duration) => {
        console.log(`Timer control: ${action} for exercise ${exerciseIndex + 1}${duration ? `, duration: ${duration}s` : ''}`);
        const completedExercises = normalizedWorkout.exercises.slice(0, exerciseIndex).map((e: any) => e.name);
        if (onGuidedActivityStartRef.current) {
          const completedExerciseIndices = Array.from({ length: exerciseIndex }, (_, i) => i);
          onGuidedActivityStartRef.current(activityType, {
            title: normalizedWorkout.title,
            exercises: normalizedWorkout.exercises,
            currentExerciseIndex: exerciseIndex,
            completedExercises,
            completedExerciseIndices,
            isTimerRunning: action === 'start',
            isResting: false,
            timerDuration: duration
          });
        }
      },
      onRestPeriod: (action, exerciseIndex, duration) => {
        console.log(`Rest period: ${action} after exercise ${exerciseIndex + 1}${duration ? `, ${duration}s` : ''}`);
        if (action === 'start') {
          currentRestStateRef.current = { isResting: true, restDuration: duration, exerciseIndex };
        } else {
          currentRestStateRef.current = null;
        }
        const completedCount = action === 'start' ? exerciseIndex + 1 : exerciseIndex;
        const completedExercises = normalizedWorkout.exercises
          .slice(0, Math.max(0, completedCount))
          .map((e: any) => e.name);
        if (onGuidedActivityStartRef.current) {
          const completedExerciseIndices = Array.from({ length: Math.max(0, completedCount) }, (_, i) => i);
          onGuidedActivityStartRef.current(activityType, {
            title: normalizedWorkout.title,
            exercises: normalizedWorkout.exercises,
            currentExerciseIndex: exerciseIndex,
            completedExercises,
            completedExerciseIndices,
            isTimerRunning: action === 'start',
            isResting: action === 'start',
            restDuration: duration,
            timerDuration: duration
          });
        }
      },
      onActivityComplete: async () => {
        console.log('Guided activity completed');
        stopGuidanceKeepalive();
        isGuidanceActiveRef.current = false;
        isExpectingGuidanceResponseRef.current = false;
        currentRestStateRef.current = null;
        lastWorkoutListRef.current = null;
        clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
          .catch(e => console.warn('Failed to clear guidance state:', e));
        if (onActivityControlRef.current) {
          onActivityControlRef.current('stop');
        }
      },
      onProgressUpdate: (currentProgress) => {
        contextRef.current = updateContext(contextRef.current, {
          currentWorkoutProgress: {
            title: normalizedWorkout.title,
            totalExercises: currentProgress.totalExercises,
            completedCount: currentProgress.currentExerciseIndex,
            completedExercises: currentProgress.completedExercises,
            remainingExercises: [],
            startedAt: Date.now() - currentProgress.elapsedTime,
            minutesSinceStarted: Math.floor(currentProgress.elapsedTime / 60000)
          }
        });

        if (onGuidedActivityStartRef.current) {
          const completedExerciseIndices = Array.from(
            { length: currentProgress.currentExerciseIndex },
            (_, i) => i
          );
          onGuidedActivityStartRef.current(activityType, {
            title: normalizedWorkout.title,
            exercises: normalizedWorkout.exercises,
            currentExerciseIndex: currentProgress.currentExerciseIndex,
            completedExercises: currentProgress.completedExercises,
            completedExerciseIndices
          });
        }
      }
    });

    if (onGuidedActivityStartRef.current) {
      onGuidedActivityStartRef.current(activityType, {
        title: normalizedWorkout.title,
        exercises: normalizedWorkout.exercises,
        currentExerciseIndex: 0,
        completedExercises: [],
        completedExerciseIndices: []
      });
    }

    if (options?.attemptRestoreDetailedState) {
      const detailedState = loadGuidanceExecutorState();
      if (detailedState) {
        getGuidanceExecutor().restoreDetailedState(detailedState);
        console.log('LiveSession: Restored detailed executor state for seamless resume');
      }
    }

    lastGuidanceCueTimeRef.current = Date.now();
    executor.start();
    isGuidanceActiveRef.current = true;
    isExpectingGuidanceResponseRef.current = true;
    startGuidanceKeepalive();
  }, [resumeGuidance, userId, activeWorkoutMessageId, sendGuidanceCueToGemini, startGuidanceKeepalive]);

  const startGuidanceForTimer = useCallback((activityType: string, config: any) => {
    const executor = getGuidanceExecutor();
    const progress = executor.getProgress();
    guidanceExecutorRef.current = executor;

    if (progress.status !== 'idle') {
      resumeGuidance();
      return;
    }

    const duration = config.duration || config.durationSeconds || (config.durationMinutes ? config.durationMinutes * 60 : 300);
    const durationMinutes = config.durationMinutes || Math.max(1, Math.floor(duration / 60));
    const label = config.label || activityType;
    const timerTimestamp = Date.now();
    const normalizedConfig = {
      ...config,
      duration,
      durationMinutes,
      label,
      guidanceStyle: config.guidanceStyle || config.style || config.guidance?.style,
      intent: config.intent || config.guidance?.intent
    };
    const guidanceConfig = createGuidanceConfig(activityType, normalizedConfig);

    executor.initialize(guidanceConfig, {
      onCue: (cue, text) => {
        console.log(`GuidanceCue [${cue.type}]:`, text);
        sendGuidanceCueToGemini(text, cue.type);
      },
      onExerciseStart: (name, index) => {
        console.log(`Exercise started: ${name} (${index + 1})`);
      },
      onExerciseComplete: (name, index) => {
        console.log(`Exercise complete: ${name} (${index + 1})`);
      },
      onActivityComplete: async () => {
        console.log('Guided activity completed');
        stopGuidanceKeepalive();
        isGuidanceActiveRef.current = false;
        isExpectingGuidanceResponseRef.current = false;
        currentRestStateRef.current = null;
        lastTimerRef.current = null;
        saveWorkoutRefs({
          workoutListsMap: Array.from(workoutListsMapRef.current.entries()),
          lastWorkoutList: lastWorkoutListRef.current,
          lastTimer: lastTimerRef.current
        });
        clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
          .catch(e => console.warn('Failed to clear guidance state:', e));
      },
      onProgressUpdate: (currentProgress) => {
        contextRef.current = updateContext(contextRef.current, {
          activeTimer: {
            label,
            totalSeconds: duration,
            remainingSeconds: currentProgress.remainingTime,
            isRunning: currentProgress.status === 'active',
            startedAt: timerTimestamp
          }
        });

        if (onGuidedActivityStartRef.current) {
          onGuidedActivityStartRef.current(activityType, {
            ...normalizedConfig,
            currentExerciseIndex: currentProgress.currentExerciseIndex,
            completedExercises: currentProgress.completedExercises
          });
        }
      }
    });

    executor.start();
    isGuidanceActiveRef.current = true;
    isExpectingGuidanceResponseRef.current = true;
    lastGuidanceCueTimeRef.current = Date.now();
    startGuidanceKeepalive();
    lastTimerRef.current = {
      label,
      duration,
      activityType,
      config: normalizedConfig,
      timestamp: timerTimestamp
    };
    saveWorkoutRefs({
      workoutListsMap: Array.from(workoutListsMapRef.current.entries()),
      lastWorkoutList: lastWorkoutListRef.current,
      lastTimer: lastTimerRef.current
    });

    if (onGuidedActivityStartRef.current) {
      onGuidedActivityStartRef.current(activityType, normalizedConfig);
    }

    console.log('LiveSession: Started guidance for timer activity');
  }, [resumeGuidance, userId, activeWorkoutMessageId, sendGuidanceCueToGemini, startGuidanceKeepalive]);

  // ──────────────────────────────────────────────────────────────────────────
  // RETURN
  // ──────────────────────────────────────────────────────────────────────────

  return {
    // Connection
    status,
    connect,
    disconnect,

    // Activity state
    paceState,
    isMuted,
    setIsMuted,

    // Utilities
    audioQuality: audioQualityRef.current,
    turnCount: sessionStateRef.current.turnCount,
    isSpeaking, // Export speech state
    isProcessing, // Export processing state
    connectionQuality, // Export connection quality state
    errorMessage, // Export error message

    // Guidance state for message categorization
    isExpectingGuidanceResponse: isExpectingGuidanceResponseRef,
    isGuidanceActive: isGuidanceActiveRef,

    // Send message to Live Mode
    sendMessageToLive,

    // Guidance control methods
    pauseGuidance: () => {
      if (guidanceExecutorRef.current) {
        guidanceExecutorRef.current.pause();
        // Keep isGuidanceActiveRef true so messages are still categorized as guidance
        // But stop expecting responses until resume
        isExpectingGuidanceResponseRef.current = false;
        stopGuidanceKeepalive();
        console.log('LiveSession: Paused guidance executor');
      }
    },
    resumeGuidance,
    skipGuidance: () => {
      if (guidanceExecutorRef.current) {
        guidanceExecutorRef.current.skip();
      }
    },
    goBackGuidance: () => {
      if (guidanceExecutorRef.current) {
        guidanceExecutorRef.current.goBack();
      }
    },
    startGuidanceForTimer,
    stopGuidance: () => {
      if (guidanceExecutorRef.current) {
        const executor = guidanceExecutorRef.current;
        const progress = executor.getProgress();
        // Only call stop() if executor is not already completed/idle to prevent circular calls
        if (progress.status !== 'completed' && progress.status !== 'idle') {
          executor.stop();
        }
        guidanceExecutorRef.current = null;
        // Reset guidance state flags
        isGuidanceActiveRef.current = false;
        isExpectingGuidanceResponseRef.current = false;
        console.log('LiveSession: Stopped guidance executor');
      }
    }
  };
};
