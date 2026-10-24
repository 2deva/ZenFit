import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider, useAppContext } from '../AppContext';
import { getDashboardSnapshot } from '../../services/toolIntegrationService';
import { createCalendarEvent } from '../../services/calendarService';
import { syncService } from '../../services/syncService';
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: null, accessToken: null }) }));
vi.mock('../../supabaseConfig', () => ({ supabase: {}, isSupabaseConfigured: false }));
vi.mock('../../services/supabaseService', () => ({ getMessages: vi.fn(async () => []), saveMessage: vi.fn(async () => true), deleteAllMessages: vi.fn(async () => true), extractOnboardingContext: vi.fn(async () => {}), recordInteraction: vi.fn(async () => {}), getOnboardingState: vi.fn(async () => null), createScheduledEvent: vi.fn(async () => true), detectPsychologicalState: vi.fn(() => 'unknown') }));
vi.mock('../../services/userContextService', () => ({ getFullUserContext: vi.fn(async () => null), buildLifeContext: vi.fn(async () => null) }));
vi.mock('../../services/geminiService', () => ({ buildSystemInstruction: vi.fn(async () => 'fixture system instruction') }));
vi.mock('../../services/embeddingService', () => ({ extractAndStoreSummary: vi.fn(async () => true) }));
vi.mock('../../services/calendarService', () => ({ createCalendarEvent: vi.fn(async () => null), getCalendarContext: vi.fn(async () => 'Not connected'), getFreeSlotsContext: vi.fn(async () => ({ freeSlotsSummary: '', nextFreeWindow: '' })), getUpcomingEvents: vi.fn(async () => []) }));
vi.mock('../../handlers/actionHandlers', () => ({ createActionHandlers: () => ({}), handleAction: vi.fn() }));
vi.mock('../../services/exerciseGifService', () => ({ getExercisePool: vi.fn(async () => []) }));
vi.mock('../../services/syncService', () => ({ syncService: { scheduleOperation: vi.fn() } }));
vi.mock('../../services/toolIntegrationService', () => ({ getDashboardSnapshot: vi.fn() }));
const wrapper = ({ children }: { children: React.ReactNode }) => <AppContextProvider>{children}</AppContextProvider>;
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(getDashboardSnapshot).mockResolvedValue({ generatedAt: Date.now(), userId: 'user', goals: [], recentWorkouts: [], tools: {}, achievements: { unlocked: [], nextUp: [] } } as never); });

describe('application chat and activity orchestration', () => {
  it('deduplicates immediate repeated local messages', async () => {
    const { result } = renderHook(useAppContext, { wrapper }); await waitFor(() => expect(result.current.isMessagesInitialized).toBe(true));
    act(() => { result.current.addMessageToChat('Ready'); result.current.addMessageToChat('Ready'); });
    expect(result.current.messages).toHaveLength(1); expect(result.current.getUserContext().isAuthenticated).toBe(false);
  });
  it('normalizes model timer duration against the user request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'Take 1 minute.', uiComponent: { type: 'timer', props: { duration: 300, label: 'Reset' } } }), { status: 200 }));
    const { result } = renderHook(useAppContext, { wrapper });
    await act(async () => result.current.handleSendMessage('One minute please'));
    expect(result.current.messages).toHaveLength(2); expect(result.current.messages[1].uiComponent?.props.duration).toBe(60); expect(result.current.isTyping).toBe(false);
  });
  it('keeps malformed workout UI renderable and tracks the proposed session', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: '', uiComponent: { type: 'workoutList', props: { exercises: [] } } }), { status: 200 }));
    const { result } = renderHook(useAppContext, { wrapper }); await act(async () => result.current.handleSendMessage('A short stretch'));
    expect(result.current.messages[1].uiComponent?.props.exercises).toHaveLength(1); expect(result.current.currentWorkoutProgress?.exercises).toHaveLength(1);
  });
  it('normalizes provided exercises and preserves safe workout metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'Here is your reset.', uiComponent: { type: 'workoutList', props: { title: 'Reset', exercises: [{ name: 'Plank', duration: '30 seconds' }] } } }), { status: 200 }));
    const { result } = renderHook(useAppContext, { wrapper }); await act(async () => result.current.handleSendMessage('A 5 minute workout'));
    expect(result.current.messages[1].uiComponent?.props.exercises[0].name).toBe('Plank'); expect(result.current.lastGeneratedWorkout?.exerciseCount).toBe(1);
  });
  it.each([500, 200])('provides a useful fallback for an HTTP %i empty response', async status => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));
    const { result } = renderHook(useAppContext, { wrapper }); await act(async () => result.current.handleSendMessage('Hello'));
    expect(result.current.messages[1].text.length).toBeGreaterThan(0); expect(result.current.isTyping).toBe(false);
  });
  it('keeps network failures in the chat and ignores whitespace-only input', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(useAppContext, { wrapper }); await act(async () => result.current.handleSendMessage('   ')); expect(result.current.messages).toEqual([]);
    await act(async () => result.current.handleSendMessage('Hello')); expect(result.current.messages[1].text).toContain('trouble connecting');
  });
  it('reports a confirmed Calendar write through the UI', async () => {
    vi.mocked(createCalendarEvent).mockResolvedValue({ id: 'event', summary: 'Reset', start: {}, end: {} });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ functionCalls: [{ name: 'createCalendarEvent', args: { title: 'Reset', scheduledTime: '2026-10-24T12:00:00Z', durationMinutes: 5 } }] }), { status: 200 }));
    const { result } = renderHook(useAppContext, { wrapper }); await act(async () => result.current.handleSendMessage('Schedule a reset'));
    expect(result.current.messages[1].uiComponent?.type).toBe('calendarEventAdded'); expect(result.current.messages[1].text).toBe('Done.');
  });
  it('refreshes dashboard data once within its cache window', async () => {
    const { result } = renderHook(useAppContext, { wrapper }); act(() => result.current.setSupabaseUserId('user'));
    await waitFor(() => expect(result.current.dashboardSnapshot).not.toBeNull());
    await act(async () => { await result.current.refreshDashboardSnapshot(); }); expect(getDashboardSnapshot).toHaveBeenCalledOnce();
  });
  it('clears the UI and schedules explicit account data deletion', async () => {
    const { result } = renderHook(useAppContext, { wrapper }); act(() => result.current.setSupabaseUserId('user')); await waitFor(() => expect(result.current.isMessagesInitialized).toBe(true));
    await act(async () => result.current.clearHistory()); expect(result.current.messages).toEqual([]); expect(result.current.userProfile.goals).toEqual([]);
    expect(syncService.scheduleOperation).toHaveBeenCalledWith('DELETE_ALL_DATA', { userId: 'user' });
  });
});
