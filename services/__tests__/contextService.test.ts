import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSystemContext, compressContext, createEmptyContext, updateContext, shouldRefreshContext, refreshContext, summarizeHistory, formatContextForLive } from '../contextService';
import { getFullUserContext, buildLifeContext } from '../userContextService';
import { getOnboardingState } from '../supabaseService';
import { MessageRole } from '../../types';
const model = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('../opikGemini', () => ({ ai: { models: model } }));
vi.mock('../userContextService', () => ({ getFullUserContext: vi.fn(), buildLifeContext: vi.fn() }));
vi.mock('../supabaseService', () => ({ getOnboardingState: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(1000000); });

describe('voice context refresh and provenance', () => {
  it('initializes guest context and refreshes at time/turn boundaries', () => {
    const context = createEmptyContext(); expect(context).toMatchObject({ isAuthenticated: false, voiceSessionActive: false, conversationTurnCount: 0 });
    expect(shouldRefreshContext(context)).toBe(false); expect(shouldRefreshContext(context.lastContextRefresh, 10)).toBe(true);
    expect(shouldRefreshContext(context.lastContextRefresh - 300000, 0)).toBe(true); expect(shouldRefreshContext(context.lastContextRefresh, 0, true)).toBe(true);
    expect(updateContext(context, { userName: 'Fixture' }).userName).toBe('Fixture'); expect(context.userName).toBeUndefined();
  });
  it('retains active-session context and identifies simulated measurements', async () => {
    const context = { ...createEmptyContext(), userName: 'Fixture', isAuthenticated: true, activeTimer: { label: 'Reset', totalSeconds: 60, remainingSeconds: 30, isRunning: true, startedAt: 1 }, fitnessStats: { steps: 100, calories: 20, activeMinutes: 2, stepsGoal: 8000, dataSource: 'simulated' as const }, memoryContext: { goals: [{ type: 'cardio', label: 'Move daily', motivation: null }], streaks: [{ habitType: 'workout', currentStreak: 7, longestStreak: 7 }], recentWorkouts: [{ completed: true, type: 'mobility', daysAgo: 0 }, { completed: true, type: 'cardio', daysAgo: 1 }], relevantMemories: ['Enjoys short sessions'], upcomingEvents: [] } };
    const instruction = buildSystemContext(context);
    expect(instruction).toContain('Simulated sample data'); expect(instruction).toContain('[ACTIVE TIMER]'); expect(instruction).toContain('[MILESTONE ALERT]'); expect(instruction).toContain('[PROGRESS VISUALIZATION]');
    expect(await compressContext(context)).toContain('Move daily'); expect(await compressContext(context, 8)).toContain('Fixture');
    expect(formatContextForLive(context)).toEqual({ systemInstruction: instruction });
  });
  it('loads authenticated context while retaining local identity overrides', async () => {
    vi.mocked(getFullUserContext).mockResolvedValue({ goals: [], streaks: [], recentWorkouts: [], relevantMemories: [], upcomingEvents: [] });
    vi.mocked(getOnboardingState).mockResolvedValue({ stage: 'initial', profileCompleteness: 20, primaryMotivation: 'strength', healthConditions: [], totalInteractions: 3 } as never);
    vi.mocked(buildLifeContext).mockResolvedValue(null);
    expect(await refreshContext('user', { userName: 'Fixture' })).toMatchObject({ userName: 'Fixture', isAuthenticated: true, onboardingState: { stage: 'initial', primaryMotivation: 'strength' } });
    expect((await refreshContext(undefined)).isAuthenticated).toBe(false);
  });
  it('returns base context when data refresh fails and avoids fabricated summaries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); vi.mocked(getFullUserContext).mockRejectedValue(new Error('offline'));
    expect(await refreshContext('user')).toMatchObject({ isAuthenticated: true }); expect(await summarizeHistory([])).toBe('');
    model.generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'Prefers a short reset' }] } }] });
    const messages = [{ id: 'm', role: MessageRole.USER, text: 'I want a five-minute reset', timestamp: 1 }];
    expect(await summarizeHistory(messages)).toBe('Prefers a short reset');
    model.generateContent.mockRejectedValue(new Error('unavailable')); expect(await summarizeHistory(messages)).toBe('');
  });
});
