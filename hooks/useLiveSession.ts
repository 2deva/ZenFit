/**
 * Enhanced Live Session Hook
 * 
 * Provides real-time voice interaction with context injection, voice commands,
 * error handling, and seamless integration with text mode.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { API_KEY, MODEL_LIVE, SYSTEM_INSTRUCTION } from '../constants';
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
  extractAndStoreSessionSummary
} from '../services/liveSessionMemoryService';

import { processToolInterceptors } from '../services/toolMiddleware';
import { normalizeTimerProps } from '../utils/timerProps';

import { createCalendarEvent, getUpcomingEvents } from '../services/calendarService';

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
  onActivityControl?: (action: 'pause' | 'resume' | 'skip' | 'stop' | 'back') => void;

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
  const keepaliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastGuidanceCueTimeRef = useRef<number>(0);

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
        // Small delay for rapid cues to prevent overwhelming API
        const timeSinceLastCue = Date.now() - lastGuidanceCueTimeRef.current;
        const minDelay = cueType === 'count' ? 100 : 500; // Shorter delay for counting, longer for instructions

        const sendCue = () => {
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
        };

        if (timeSinceLastCue < minDelay) {
          // Delay to prevent overwhelming API
          setTimeout(sendCue, minDelay - timeSinceLastCue);
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
          console.log('LiveSession: Loaded workout refs from persistence');
        }
      } catch (e) {
        console.warn('Failed to load workout refs:', e);
      }
    };
    loadWorkoutRefs();
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

  // Stabilize AI client
  const aiRef = useRef<GoogleGenAI | null>(null);
  if (!aiRef.current) {
    aiRef.current = new GoogleGenAI({ apiKey: API_KEY });
  }
  const ai = aiRef.current;

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

            if (action === 'startGuided' && selectedOption.data?.exercises) {
              // Auto-start guided activity with the workout exercises
              const executor = getGuidanceExecutor();
              const config = createGuidanceConfig('workout', {
                title: selectedOption.data.title || 'Workout',
                exercises: selectedOption.data.exercises,
                pace: 'normal'
              });

              executor.initialize(config, {
                onCue: (cue, text) => {
                  console.log(`GuidanceCue [${cue.type}]:`, text);
                  sendGuidanceCueToGemini(text, cue.type);
                },
                onExerciseStart: (name, index) => {
                  console.log(`Exercise started: ${name} (${index + 1}/${selectedOption.data.exercises?.length || '?'})`);
                  // Update WorkoutList to show current active exercise
                  if (onGuidedActivityStartRef.current && selectedOption?.data?.exercises) {
                    const exercises = selectedOption.data.exercises;
                    const completedExercises = exercises.slice(0, index).map((e: any) => e.name);
                    onGuidedActivityStartRef.current('workout', {
                      title: selectedOption.data.title || 'Workout',
                      exercises,
                      currentExerciseIndex: index,
                      completedExercises,
                      isTimerRunning: false // Timer starts on "Go!" cue
                    });
                  }
                },
                onExerciseComplete: (name, index) => {
                  console.log(`Exercise complete: ${name} (${index + 1}/${selectedOption.data.exercises?.length || '?'})`);
                  // Update parent with exercise completion for UI sync
                  if (onGuidedActivityStartRef.current && selectedOption?.data?.exercises) {
                    const exercises = selectedOption.data.exercises;
                    const completedExercises = exercises.slice(0, index + 1).map((e: any) => e.name);
                    onGuidedActivityStartRef.current('workout', {
                      title: selectedOption.data.title || 'Workout',
                      exercises,
                      currentExerciseIndex: index + 1,
                      completedExercises,
                      isTimerRunning: false // Timer stops when exercise completes
                    });
                  }
                },
                onTimerControl: (action, exerciseIndex, duration) => {
                  console.log(`Timer control: ${action} for exercise ${exerciseIndex + 1}${duration ? `, duration: ${duration}s` : ''}`);
                  if (onGuidedActivityStartRef.current && selectedOption?.data?.exercises) {
                    const exercises = selectedOption.data.exercises;
                    const completedExercises = exercises.slice(0, exerciseIndex).map((e: any) => e.name);
                    onGuidedActivityStartRef.current('workout', {
                      title: selectedOption.data.title || 'Workout',
                      exercises,
                      currentExerciseIndex: exerciseIndex,
                      completedExercises,
                      isTimerRunning: action === 'start',
                      isResting: false,
                      timerDuration: duration
                    });
                  }
                },
                onRestPeriod: (action, exerciseIndex, duration) => {
                  console.log(`Rest period: ${action} after exercise ${exerciseIndex + 1}${duration ? `, ${duration}s` : ''}`);
                  // Track rest state for recovery
                  if (action === 'start') {
                    currentRestStateRef.current = { isResting: true, restDuration: duration, exerciseIndex };
                  } else {
                    currentRestStateRef.current = null;
                  }
                  if (onGuidedActivityStartRef.current && selectedOption?.data?.exercises) {
                    const exercises = selectedOption.data.exercises;
                    const completedExercises = exercises.slice(0, exerciseIndex + 1).map((e: any) => e.name);
                    onGuidedActivityStartRef.current('workout', {
                      title: selectedOption.data.title || 'Workout',
                      exercises,
                      currentExerciseIndex: exerciseIndex,
                      completedExercises,
                      isTimerRunning: action === 'start',
                      isResting: action === 'start',
                      restDuration: duration,
                      timerDuration: duration
                    });
                  }
                },
                onActivityComplete: () => {
                  console.log('Guided activity completed');
                  stopGuidanceKeepalive();
                  currentRestStateRef.current = null; // Clear rest state
                  // Clear saved guidance state on successful completion
                  // import('../services/persistenceService').then(({ clearGuidanceState }) => { // Using static import
                  clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
                    .catch(e => console.warn('Failed to clear guidance state:', e));
                  // }).catch(e => console.warn('Failed to import persistence service:', e));
                  // Don't call onActivityControl('stop') here - executor is already completing,
                  // and that would cause a circular call loop. Cleanup is handled by stopGuidance().
                },
                onProgressUpdate: (progress) => {
                  // Update context for Gemini awareness
                  contextRef.current = updateContext(contextRef.current, {
                    currentWorkoutProgress: {
                      title: selectedOption.data.title || 'Workout',
                      totalExercises: progress.totalExercises,
                      completedCount: progress.currentExerciseIndex,
                      completedExercises: progress.completedExercises,
                      remainingExercises: [],
                      startedAt: Date.now() - progress.elapsedTime,
                      minutesSinceStarted: Math.floor(progress.elapsedTime / 60000)
                    }
                  });

                  // Notify parent component to update WorkoutList state
                  if (onGuidedActivityStartRef.current) {
                    // This will update App.tsx state which flows to WorkoutList
                    onGuidedActivityStartRef.current('workout', {
                      title: selectedOption.data.title || 'Workout',
                      exercises: selectedOption.data.exercises,
                      currentExerciseIndex: progress.currentExerciseIndex,
                      completedExercises: progress.completedExercises
                    });
                  }
                }
              });

              // Initialize last cue time
              lastGuidanceCueTimeRef.current = Date.now();

              executor.start();

              // Start keepalive during guidance
              startGuidanceKeepalive();

              // Initialize workout progress - explicitly set to start of workout
              if (onGuidedActivityStartRef.current) {
                onGuidedActivityStartRef.current('workout', {
                  title: selectedOption.data.title,
                  exercises: selectedOption.data.exercises,
                  currentExerciseIndex: 0,  // Explicitly start at first exercise
                  completedExercises: []     // No exercises completed yet
                });
              }
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
            return true;
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

    // Check for auto-start readiness phrases when workoutList or timer is available
    const readinessPhrases = ['ready', "i'm ready", "i am ready", "let's go", "lets go", 'go', 'start', 'begin', 'okay start', 'ok start', 'yes', 'yes i am ready'];
    const lowerTranscript = transcript.toLowerCase().trim();
    const isReadinessPhrase = readinessPhrases.some(phrase => lowerTranscript.includes(phrase));

    // PRIORITY: If user says ready and we have a recent timer, auto-start guidance for timer
    if (isReadinessPhrase && lastTimerRef.current) {
      const timeSinceTimer = Date.now() - lastTimerRef.current.timestamp;
      // Only auto-start if timer was shown in last 60 seconds
      if (timeSinceTimer < 60000) {
        console.log('LiveSession: Auto-starting guidance for timer on readiness phrase');

        const { activityType, config } = lastTimerRef.current;
        const executor = getGuidanceExecutor();
        const guidanceConfig = createGuidanceConfig(activityType, config);

        guidanceExecutorRef.current = executor;

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
          onActivityComplete: () => {
            console.log('Guided activity completed');
            stopGuidanceKeepalive();
            isGuidanceActiveRef.current = false;
            isExpectingGuidanceResponseRef.current = false;
            lastTimerRef.current = null; // Clear after completion
            currentRestStateRef.current = null; // Clear rest state
            // Clear saved guidance state on successful completion
            // import('../services/persistenceService').then(({ clearGuidanceState }) => { // Using static import
            clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
              .catch(e => console.warn('Failed to clear guidance state:', e));
            // }).catch(e => console.warn('Failed to import persistence service:', e));
            // Don't call onActivityControl('stop') here - executor is already completing,
            // and that would cause a circular call loop. Cleanup is handled by stopGuidance().
          },
          onProgressUpdate: (progress) => {
            if (!lastTimerRef.current) {
              // Timer reference was cleared (e.g., after completion or error); avoid null access
              return;
            }
            // Update context with timer progress
            contextRef.current = updateContext(contextRef.current, {
              activeTimer: {
                label: lastTimerRef.current.label,
                totalSeconds: lastTimerRef.current.duration,
                remainingSeconds: progress.remainingTime,
                isRunning: progress.status === 'active',
                startedAt: lastTimerRef.current.timestamp || Date.now()
              }
            });

            // Notify parent to update timer state
            if (onGuidedActivityStartRef.current) {
              onGuidedActivityStartRef.current(activityType, {
                ...config,
                currentExerciseIndex: progress.currentExerciseIndex,
                completedExercises: progress.completedExercises
              });
            }
          }
        });

        executor.start();
        isGuidanceActiveRef.current = true;
        isExpectingGuidanceResponseRef.current = true;
        lastGuidanceCueTimeRef.current = Date.now();
        startGuidanceKeepalive();

        // Notify parent to update timer state
        if (onGuidedActivityStartRef.current) {
          onGuidedActivityStartRef.current(activityType, config);
        }

        // Clear timer ref to prevent duplicate starts
        lastTimerRef.current = null;

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
        console.log('LiveSession: Auto-starting guidance on readiness phrase');

        // Update lastWorkoutListRef to point to the workout we're using
        // This ensures all callbacks have access to the correct workout data
        lastWorkoutListRef.current = workoutToUse;

        const executor = getGuidanceExecutor();
        const config = createGuidanceConfig('workout', {
          title: workoutToUse.title,
          exercises: workoutToUse.exercises,
          pace: 'normal'
        });

        executor.initialize(config, {
          onCue: (cue, text) => {
            console.log(`GuidanceCue [${cue.type}]:`, text);
            sendGuidanceCueToGemini(text, cue.type);
          },
          onExerciseStart: (name, index) => {
            console.log(`Exercise started: ${name} (${index + 1}/${workoutToUse.exercises.length || '?'})`);
            // Update WorkoutList to show current active exercise
            if (onGuidedActivityStartRef.current && workoutToUse) {
              // When exercise starts, all PREVIOUS exercises are completed
              const completedExercises = workoutToUse.exercises
                .slice(0, index)  // Exercises before current index
                .map((e: any) => e.name);

              onGuidedActivityStartRef.current('workout', {
                title: workoutToUse.title,
                exercises: workoutToUse.exercises,
                currentExerciseIndex: index,  // Current exercise index (0-based)
                completedExercises            // All prior exercises
              });
            }
          },
          onExerciseComplete: (name, index) => {
            console.log(`Exercise complete: ${name} (${index + 1}/${workoutToUse.exercises.length || '?'})`);
            // Immediately update parent with completed exercise for instant UI sync
            if (onGuidedActivityStartRef.current && workoutToUse) {
              // When exercise completes, include it in completed list
              const completedExercises = workoutToUse.exercises
                .slice(0, index + 1)  // Current exercise is now completed
                .map((e: any) => e.name);

              onGuidedActivityStartRef.current('workout', {
                title: workoutToUse.title,
                exercises: workoutToUse.exercises,
                currentExerciseIndex: index + 1, // Move to next exercise
                completedExercises
              });
            }
          },
          onActivityComplete: async () => {
            console.log('Guided activity completed');
            stopGuidanceKeepalive();
            isGuidanceActiveRef.current = false;
            isExpectingGuidanceResponseRef.current = false;
            lastWorkoutListRef.current = null; // Clear after completion
            currentRestStateRef.current = null; // Clear rest state
            // Clear saved guidance state on successful completion
            // import('../services/persistenceService').then(({ clearGuidanceState }) => { // Using static import
            clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
              .catch(e => console.warn('Failed to clear guidance state:', e));
            // }).catch(e => console.warn('Failed to import persistence service:', e));
            // Don't call onActivityControl('stop') here - executor is already completing,
            // and that would cause a circular call loop. Cleanup is handled by stopGuidance().
          },
          onTimerControl: (action, exerciseIndex, duration) => {
            console.log(`Timer control: ${action} for exercise ${exerciseIndex + 1}${duration ? `, duration: ${duration}s` : ''}`);
            // Update workout progress with timer state
            if (onGuidedActivityStartRef.current && lastWorkoutListRef.current) {
              const completedExercises = lastWorkoutListRef.current.exercises
                .slice(0, exerciseIndex)
                .map((e: any) => e.name);

              onGuidedActivityStartRef.current('workout', {
                title: lastWorkoutListRef.current.title,
                exercises: lastWorkoutListRef.current.exercises,
                currentExerciseIndex: exerciseIndex,
                completedExercises,
                isTimerRunning: action === 'start',
                isResting: false, // Exercise timer, not rest
                timerDuration: duration
              });
            }
          },
          onRestPeriod: (action, exerciseIndex, duration) => {
            console.log(`Rest period: ${action} after exercise ${exerciseIndex + 1}${duration ? `, ${duration}s` : ''}`);
            // Track rest state for recovery
            if (action === 'start') {
              currentRestStateRef.current = { isResting: true, restDuration: duration, exerciseIndex };
            } else {
              currentRestStateRef.current = null;
            }
            // Update workout progress with rest state
            if (onGuidedActivityStartRef.current && lastWorkoutListRef.current) {
              const completedExercises = lastWorkoutListRef.current.exercises
                .slice(0, exerciseIndex + 1) // Current exercise is done during rest
                .map((e: any) => e.name);

              onGuidedActivityStartRef.current('workout', {
                title: lastWorkoutListRef.current.title,
                exercises: lastWorkoutListRef.current.exercises,
                currentExerciseIndex: exerciseIndex,
                completedExercises,
                isTimerRunning: action === 'start', // Timer runs during rest
                isResting: action === 'start',
                restDuration: duration,
                timerDuration: duration
              });
            }
          },
          onProgressUpdate: (progress) => {
            // Update context with progress for Gemini awareness
            contextRef.current = updateContext(contextRef.current, {
              currentWorkoutProgress: {
                title: lastWorkoutListRef.current!.title,
                totalExercises: progress.totalExercises,
                completedCount: progress.currentExerciseIndex,
                completedExercises: progress.completedExercises,
                remainingExercises: [],
                startedAt: Date.now() - progress.elapsedTime,
                minutesSinceStarted: Math.floor(progress.elapsedTime / 60000)
              }
            });

            // Notify parent to update WorkoutList component state
            if (onGuidedActivityStartRef.current) {
              onGuidedActivityStartRef.current('workout', {
                title: lastWorkoutListRef.current!.title,
                exercises: lastWorkoutListRef.current!.exercises,
                currentExerciseIndex: progress.currentExerciseIndex,
                completedExercises: progress.completedExercises
              });
            }
          }
        });

        guidanceExecutorRef.current = executor;
        lastGuidanceCueTimeRef.current = Date.now();

        // Initialize workout progress BEFORE starting executor
        // This ensures WorkoutList shows correct state from the beginning
        if (onGuidedActivityStartRef.current && lastWorkoutListRef.current) {
          onGuidedActivityStartRef.current('workout', {
            title: lastWorkoutListRef.current.title,
            exercises: lastWorkoutListRef.current.exercises,
            currentExerciseIndex: 0,  // Starting at first exercise
            completedExercises: []     // No exercises completed yet
          });
        }

        // Restore detailed executor state if available (for seamless resume)
        const detailedState = loadGuidanceExecutorState(); // Synchronous load from localStorage
        if (detailedState) {
          getGuidanceExecutor().restoreDetailedState(detailedState);
          console.log('LiveSession: Restored detailed executor state for seamless resume');
        }

        executor.start();
        isGuidanceActiveRef.current = true;
        isExpectingGuidanceResponseRef.current = true;
        startGuidanceKeepalive();

        // NOTE: DO NOT clear lastWorkoutListRef here!
        // The callbacks (onExerciseStart, onExerciseComplete, onProgressUpdate) 
        // need this ref to access workout data. It's cleared in onActivityComplete.

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

      if (onActivityControlRef.current) onActivityControlRef.current('skip');
      if (onVoiceCommandRef.current) onVoiceCommandRef.current(result.action, result.response);
      return true;
    }

    if (result.action === 'GO_BACK') {
      const executor = getGuidanceExecutor();
      executor.goBack();

      if (onActivityControlRef.current) onActivityControlRef.current('back');
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
                  // Check for resumable workout from context or saved state
                  const context = contextRef.current;
                  // Handle both workout progress formats: with exercises array or summary format
                  const contextWorkout = context?.currentWorkoutProgress as any;
                  const hasContextWorkout = contextWorkout && (
                    (contextWorkout.exercises && Array.isArray(contextWorkout.exercises) && contextWorkout.exercises.length > 0) ||
                    (contextWorkout.totalExercises && contextWorkout.totalExercises > 0)
                  );
                  const hasSavedGuidance = savedGuidanceState && savedGuidanceState.activityType === 'workout';

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
                          const resumePrompt = wasDisconnected
                            ? `[SYSTEM NOTE: The user was disconnected during their workout "${progress.title || 'Workout'}" with ${completedCount}/${totalCount} exercises completed. Briefly acknowledge the reconnection and ask if they'd like to resume from exercise ${completedCount + 1} or start fresh.]`
                            : `[SYSTEM NOTE: The user has an in-progress workout "${progress.title}" with ${completedCount}/${totalCount} exercises completed. Ask if they'd like to resume or start fresh.]`;
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
                      if (isConnectedRef.current && isSessionReadyRef.current) {
                        try {
                          sess.sendRealtimeInput({ media: pcmBlob });
                        } catch (err: any) {
                          const msg = typeof err?.message === 'string' ? err.message : '';
                          // If WS is closing/closed, stop trying to send and reset session once.
                          if (!wsClosingHandledRef.current && /CLOSING|CLOSED/i.test(msg)) {
                            wsClosingHandledRef.current = true;
                            isSessionReadyRef.current = false;
                            if (!manualDisconnectRef.current) {
                              setTimeout(() => disconnect(false), 0);
                            }
                          }
                          console.debug('Audio send skipped - connection closing');
                        }
                      }
                    }).catch(() => {
                      // Session promise rejected, connection is gone
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
                        if (args.type === 'workoutList' && args.props?.exercises) {
                          const workoutData = {
                            exercises: args.props.exercises,
                            title: args.props.title || 'Workout',
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
                            lastWorkoutList: lastWorkoutListRef.current
                          });
                          // }).catch(e => console.warn('Failed to save workout refs:', e));

                          // Note: workoutListMessageId will be set when the message is created in App.tsx
                          // We'll track it via onToolCall callback
                          console.log('LiveSession: Tracked workoutList for auto-start detection');
                        }

                        // Track timer for auto-start detection
                        if (args.type === 'timer' && enhancedProps) {
                          const label = enhancedProps.label || 'Timer';
                          const duration = enhancedProps.duration ?? 60;

                          // Derive activity type from label
                          const labelLower = label.toLowerCase();
                          const isBreathing = labelLower.includes('breathing') || labelLower.includes('breath');
                          const isMeditation = labelLower.includes('meditation') || labelLower.includes('mindful');

                          if (isBreathing || isMeditation) {
                            const activityType = isBreathing ? 'breathing' : 'meditation';
                            const config = {
                              duration: duration,
                              durationMinutes: Math.floor(duration / 60),
                              label: label,
                              ...(isBreathing && { pattern: { name: 'box', cycles: Math.floor(duration / 60) } })
                            };

                            lastTimerRef.current = {
                              label,
                              duration,
                              activityType,
                              config,
                              timestamp: Date.now()
                            };

                            console.log('LiveSession: Tracked timer for auto-start detection:', activityType);
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

                      // Notify parent component
                      if (onGuidedActivityStartRef.current) {
                        onGuidedActivityStartRef.current(args.activityType, args);
                      }

                      // Initialize and start the guidance executor
                      const guidanceConfig = createGuidanceConfig(args.activityType, args);
                      const executor = getGuidanceExecutor();

                      // Store reference for external control
                      guidanceExecutorRef.current = executor;

                      executor.initialize(guidanceConfig, {
                        onCue: (cue, text) => {
                          console.log(`GuidanceCue [${cue.type}]:`, text);
                          sendGuidanceCueToGemini(text, cue.type);
                        },
                        onExerciseStart: (name, index) => {
                          console.log(`Exercise started: ${name} (${index + 1}/${args.exercises?.length || '?'})`);
                          // Update WorkoutList to show current active exercise
                          if (onGuidedActivityStartRef.current && args.exercises) {
                            const completedExercises = args.exercises.slice(0, index).map((e: any) => e.name);
                            onGuidedActivityStartRef.current('workout', {
                              title: args.title || 'Workout',
                              exercises: args.exercises,
                              currentExerciseIndex: index,
                              completedExercises,
                              isTimerRunning: false // Timer starts on "Go!" cue
                            });
                          }
                        },
                        onExerciseComplete: (name, index) => {
                          console.log(`Exercise complete: ${name} (${index + 1}/${args.exercises?.length || '?'})`);
                          // Update parent with exercise completion for UI sync
                          if (onGuidedActivityStartRef.current && args.exercises) {
                            const completedExercises = args.exercises.slice(0, index + 1).map((e: any) => e.name);
                            onGuidedActivityStartRef.current('workout', {
                              title: args.title || 'Workout',
                              exercises: args.exercises,
                              currentExerciseIndex: index + 1,
                              completedExercises,
                              isTimerRunning: false // Timer stops when exercise completes
                            });
                          }
                        },
                        onTimerControl: (action, exerciseIndex, duration) => {
                          console.log(`Timer control: ${action} for exercise ${exerciseIndex + 1}${duration ? `, duration: ${duration}s` : ''}`);
                          if (onGuidedActivityStartRef.current && args.exercises) {
                            const completedExercises = args.exercises.slice(0, exerciseIndex).map((e: any) => e.name);
                            onGuidedActivityStartRef.current('workout', {
                              title: args.title || 'Workout',
                              exercises: args.exercises,
                              currentExerciseIndex: exerciseIndex,
                              completedExercises,
                              isTimerRunning: action === 'start',
                              isResting: false,
                              timerDuration: duration
                            });
                          }
                        },
                        onRestPeriod: (action, exerciseIndex, duration) => {
                          console.log(`Rest period: ${action} after exercise ${exerciseIndex + 1}${duration ? `, ${duration}s` : ''}`);
                          // Track rest state for recovery
                          if (action === 'start') {
                            currentRestStateRef.current = { isResting: true, restDuration: duration, exerciseIndex };
                          } else {
                            currentRestStateRef.current = null;
                          }
                          if (onGuidedActivityStartRef.current && args.exercises) {
                            const completedExercises = args.exercises.slice(0, exerciseIndex + 1).map((e: any) => e.name);
                            onGuidedActivityStartRef.current('workout', {
                              title: args.title || 'Workout',
                              exercises: args.exercises,
                              currentExerciseIndex: exerciseIndex,
                              completedExercises,
                              isTimerRunning: action === 'start',
                              isResting: action === 'start',
                              restDuration: duration,
                              timerDuration: duration
                            });
                          }
                        },
                        onActivityComplete: () => {
                          console.log('Guided activity completed');
                          stopGuidanceKeepalive();
                          // Reset guidance state flags
                          isGuidanceActiveRef.current = false;
                          isExpectingGuidanceResponseRef.current = false;
                          currentRestStateRef.current = null; // Clear rest state
                          // Clear saved guidance state on successful completion
                          // import('../services/persistenceService').then(({ clearGuidanceState }) => { // Using static import
                          clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
                            .catch(e => console.warn('Failed to clear guidance state:', e));
                          // }).catch(e => console.warn('Failed to import persistence service:', e));
                          // Call onActivityControl('stop') for UI cleanup - safe now because stopGuidance()
                          // checks executor status and won't call stop() if already completed
                          if (onActivityControlRef.current) {
                            onActivityControlRef.current('stop');
                          }
                        },
                        onProgressUpdate: (progress) => {
                          // Update context with progress
                          contextRef.current = updateContext(contextRef.current, {
                            currentWorkoutProgress: {
                              title: args.title || args.activityType,
                              totalExercises: progress.totalExercises,
                              completedCount: progress.currentExerciseIndex,
                              completedExercises: progress.completedExercises,
                              remainingExercises: [],
                              startedAt: Date.now() - progress.elapsedTime,
                              minutesSinceStarted: Math.floor(progress.elapsedTime / 60000)
                            }
                          });
                        }
                      });

                      // Initialize last cue time
                      lastGuidanceCueTimeRef.current = Date.now();

                      // Start the executor
                      executor.start();

                      // Mark guidance as active for message categorization
                      isGuidanceActiveRef.current = true;
                      isExpectingGuidanceResponseRef.current = true;

                      // Start keepalive during guidance to prevent disconnection
                      startGuidanceKeepalive();

                      sessionPromise.then(sess => {
                        if (isConnectedRef.current) {
                          sess.sendToolResponse({
                            functionResponses: [{
                              id: fc.id,
                              name: fc.name,
                              response: { result: `Started ${args.activityType} activity with ${guidanceConfig.exercises?.length || 0} exercises` }
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
                        if (onActivityControlRef.current) onActivityControlRef.current('skip');
                      } else if (action === 'stop') {
                        executor.stop();
                        stopGuidanceKeepalive();
                        if (onActivityControlRef.current) onActivityControlRef.current('stop');
                      } else if (action === 'back') {
                        executor.goBack();
                        if (onActivityControlRef.current) onActivityControlRef.current('back');
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
                      createCalendarEvent({
                        summary: args.title,
                        start: new Date(args.scheduledTime),
                        durationMinutes: args.durationMinutes || 30,
                        description: args.description
                      }).then(result => {
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
                      getUpcomingEvents(args.maxResults || 5).then(events => {
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
            if (isConnectedRef.current) {
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
  }, []);

  const startGuidanceForTimer = useCallback((activityType: string, config: any) => {
    // Start guidance for timer activity if not already started
    const executor = getGuidanceExecutor();
    const progress = executor.getProgress();

    if (progress.status === 'idle') {
      const guidanceConfig = createGuidanceConfig(activityType, config);
      guidanceExecutorRef.current = executor;

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
          currentRestStateRef.current = null; // Clear rest state
          // Clear saved guidance state on successful completion
          // import('../services/persistenceService').then(({ clearGuidanceState }) => { // Using static import
          clearGuidanceState(userId || undefined, activeWorkoutMessageId || undefined)
            .catch(e => console.warn('Failed to clear guidance state:', e));
          // }).catch(e => console.warn('Failed to import persistence service:', e));
          // Don't call onActivityControl('stop') here - executor is already completing,
          // and that would cause a circular call loop. Cleanup is handled by stopGuidance().
        },
        onProgressUpdate: (progress) => {
          // Update context with progress if needed
          contextRef.current = updateContext(contextRef.current, {
            activeTimer: {
              label: config.label || activityType,
              totalSeconds: config.duration || config.durationMinutes * 60 || 300,
              remainingSeconds: progress.remainingTime,
              isRunning: progress.status === 'active',
              startedAt: Date.now() // Timer start time
            }
          });
        }
      });

      executor.start();
      isGuidanceActiveRef.current = true;
      isExpectingGuidanceResponseRef.current = true;
      lastGuidanceCueTimeRef.current = Date.now();
      startGuidanceKeepalive();
      console.log('LiveSession: Started guidance for timer activity');
    } else {
      // Already initialized, just resume
      resumeGuidance();
    }
  }, [resumeGuidance]);

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
