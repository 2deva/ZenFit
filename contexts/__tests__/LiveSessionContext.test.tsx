import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSessionContextProvider, useLiveSessionContext } from '../LiveSessionContext';
import { useAppContext } from '../AppContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import { LiveStatus, MessageRole } from '../../types';
import * as storage from '../../services/storageService';
vi.mock('../AppContext', () => ({ useAppContext: vi.fn() }));
vi.mock('../../hooks/useLiveSession', () => ({ useLiveSession: vi.fn() }));
vi.mock('../../supabaseConfig', () => ({ supabase: null, isSupabaseConfigured: false }));
let options: Parameters<typeof useLiveSession>[0];
let app: Record<string, any>;
let live: Record<string, any>;
let messages: any[];
const wrapper = ({ children }: { children: React.ReactNode }) => <LiveSessionContextProvider>{children}</LiveSessionContextProvider>;
beforeEach(() => {
  vi.clearAllMocks(); messages = [];
  live = { status: LiveStatus.CONNECTED, connect: vi.fn(), disconnect: vi.fn(), isMuted: false, setIsMuted: vi.fn(), isSpeaking: false,
    isExpectingGuidanceResponse: { current: false }, isGuidanceActive: { current: false }, sendMessageToLive: vi.fn(),
    pauseGuidance: vi.fn(), resumeGuidance: vi.fn(), skipGuidance: vi.fn(), goBackGuidance: vi.fn(), startGuidanceForTimer: vi.fn(), stopGuidance: vi.fn(),
    connectionQuality: 'good', isProcessing: false, errorMessage: null };
  app = { supabaseUserId: 'alice', getUserContext: () => ({}), messages, setMessages: vi.fn(update => { messages = typeof update === 'function' ? update(messages) : update; }),
    activeTimer: null, setActiveTimer: vi.fn(), currentWorkoutProgress: null, setCurrentWorkoutProgress: vi.fn(), workoutProgress: null, setWorkoutProgress: vi.fn(),
    activeWorkoutMessageId: null, setActiveWorkoutMessageId: vi.fn(), activeWorkoutMessageIdRef: { current: null },
    currentLiveModelMessageIdRef: { current: null }, currentLiveUserMessageIdRef: { current: null },
    handleActionWrapper: vi.fn(), userProfile: null, setUserProfile: vi.fn(), onboardingState: null, setOnboardingState: vi.fn(),
    activitySessions: {}, startActivity: vi.fn(() => 'timer'), pauseActivity: vi.fn(), resumeActivity: vi.fn(), completeActivity: vi.fn(), stopActivity: vi.fn(), registerActivityListener: vi.fn(() => vi.fn()) };
  vi.mocked(useAppContext).mockImplementation(() => app as never);
  vi.mocked(useLiveSession).mockImplementation(p => { options = p; return live as never; });
});
describe('live voice application routing', () => {
  it('combines partial transcripts and separates turns without duplicating messages', () => {
    renderHook(useLiveSessionContext, { wrapper });
    act(() => { options.onTranscription('Hello', true, false); options.onTranscription('Hello coach', true, false); });
    expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({ role: MessageRole.USER, text: 'Hello coach' });
    act(() => { options.onTranscription('', true, true); options.onTranscription('Welcome', false, false); options.onTranscription('back!', false, true); });
    expect(messages).toHaveLength(2); expect(messages[1].text).toBe('Welcome back!');
    act(() => options.onTranscription('Thanks', true, false)); expect(messages).toHaveLength(3);
  });
  it('keeps trailing guidance attached to its workout and resumes normal chat on user input', () => {
    app.activeWorkoutMessageIdRef.current = 'workout'; live.isGuidanceActive.current = true;
    renderHook(useLiveSessionContext, { wrapper });
    act(() => options.onTranscription('One more', false, false));
    expect(messages[0]).toMatchObject({ messageContext: 'workout_guidance', relatedWorkoutId: 'workout' });
    live.isGuidanceActive.current = false;
    act(() => { options.onTranscription('Thanks', true, true); options.onTranscription('You are welcome', false, true); });
    expect(messages.at(-1).messageContext).toBeUndefined();
  });
  it('attaches tool UI to the model turn without copying account history into guest storage', () => {
    const save = vi.spyOn(storage, 'setMessages'); renderHook(useLiveSessionContext, { wrapper });
    act(() => options.onTranscription('Try this', false, false));
    act(() => options.onToolCall?.({ type: 'timer', props: { duration: 60, label: 'Focus' } }));
    expect(messages).toHaveLength(1); expect(messages[0].uiComponent.type).toBe('timer');
    expect(app.setActiveWorkoutMessageId).toHaveBeenCalledWith(messages[0].id); expect(save).not.toHaveBeenCalled();
  });
  it('pauses active activity on disconnect and routes skip/back/stop controls', () => {
    app.activeTimer = { isRunning: true }; app.workoutProgress = { isTimerRunning: true };
    const { result } = renderHook(useLiveSessionContext, { wrapper });
    act(() => result.current.toggleLive()); expect(live.disconnect).toHaveBeenCalledWith(true);
    expect(app.setActiveTimer).toHaveBeenCalled(); expect(app.setWorkoutProgress).toHaveBeenCalled();
    act(() => { result.current.handleActivityControl('skip'); result.current.handleActivityControl('back'); result.current.handleActivityControl('stop'); });
    expect(live.skipGuidance).toHaveBeenCalledTimes(1); expect(live.goBackGuidance).toHaveBeenCalledTimes(1); expect(live.stopGuidance).toHaveBeenCalledTimes(1);
    expect(app.setCurrentWorkoutProgress).toHaveBeenCalledWith(null);
  });
  it('connects once for a pending message and sends after ready', async () => {
    vi.useFakeTimers(); live.status = LiveStatus.DISCONNECTED;
    const { result, rerender } = renderHook(useLiveSessionContext, { wrapper });
    act(() => result.current.startLiveModeAndSendMessage('Start a reset')); expect(live.connect).toHaveBeenCalledTimes(1);
    live.status = LiveStatus.CONNECTING; rerender(); act(() => result.current.startLiveModeAndSendMessage('Make it short')); expect(live.connect).toHaveBeenCalledTimes(1);
    live.status = LiveStatus.CONNECTED; rerender();
    await act(async () => vi.advanceTimersByTimeAsync(300)); expect(live.sendMessageToLive).toHaveBeenCalledWith('Make it short'); vi.useRealTimers();
  });
  it('cancels the delayed send if disconnected before delivery', async () => {
    vi.useFakeTimers(); live.status = LiveStatus.DISCONNECTED;
    const { result, rerender } = renderHook(useLiveSessionContext, { wrapper });
    act(() => result.current.startLiveModeAndSendMessage('Start')); live.status = LiveStatus.CONNECTED; rerender();
    live.status = LiveStatus.DISCONNECTED; rerender(); await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(live.sendMessageToLive).not.toHaveBeenCalled(); vi.useRealTimers();
  });
});
