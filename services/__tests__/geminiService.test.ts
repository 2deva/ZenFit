import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateUIComponent, runChatWithClient, buildSystemInstruction, sendMessageToGemini } from '../geminiService';
import { getSupportedExerciseNames } from '../exerciseGifService';
import { MessageRole } from '../../types';
const model = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('../opikGemini', () => ({ ai: { models: model } }));
vi.mock('../exerciseGifService', () => ({ getSupportedExerciseNames: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getSupportedExerciseNames).mockResolvedValue(['Plank', 'Squat']); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
const output = (parts: unknown[]) => ({ candidates: [{ content: { parts } }] });

describe('model output boundary', () => {
  it.each([
    ['timer', { duration: Infinity }], ['timer', { duration: -1 }],
    ['workoutList', { exercises: [null] }], ['workoutBuilder', { categories: [] }],
    ['chart', { data: 'invalid' }], ['map', {}],
  ])('rejects malformed %s', (type, props) => expect(validateUIComponent(type, props)).toBe(false));
  it('accepts supported empty states and well-formed generated UI', () => {
    expect(validateUIComponent('chart', { data: [] })).toBe(true);
    expect(validateUIComponent('map', { query: 'Nearby park' })).toBe(true);
    expect(validateUIComponent('workoutBuilder', { categories: [{ options: [{ id: 'strength' }] }] })).toBe(true);
    expect(validateUIComponent('timer', { duration: 60 })).toBe(true);
  });
  it('separates text, safe UI, Calendar tool calls and grounding metadata', async () => {
    const client = { models: { generateContent: vi.fn().mockResolvedValue({ ...output([
      { text: 'Begin a short reset.' }, { functionCall: { name: 'renderUI', args: { type: 'timer', props: { duration: 60 } } } },
      { functionCall: { name: 'getUpcomingEvents', args: { maxResults: 5 } } }, { thoughtSignature: 'opaque' },
    ]), }) } };
    const result = await runChatWithClient(client, [{ id: 'm', role: MessageRole.USER, text: 'Hello', timestamp: 1 }], 'Start a timer', 'system');
    expect(result).toMatchObject({ text: 'Begin a short reset.', uiComponent: { type: 'timer', props: { duration: 60 } }, functionCalls: [{ name: 'getUpcomingEvents', args: { maxResults: 5 } }] });
    expect(client.models.generateContent.mock.calls[0][0].contents).toHaveLength(2);
  });
  it('rejects invalid tool props and recovers a simple text-encoded UI call', async () => {
    const client = { models: { generateContent: vi.fn().mockResolvedValue(output([{ functionCall: { name: 'renderUI', args: { type: 'timer', props: { duration: NaN } } } }])) } };
    expect((await runChatWithClient(client, [], 'Timer', 'system')).uiComponent).toBeUndefined();
    client.models.generateContent.mockResolvedValue(output([{ text: "renderUI('timer', {'duration': 60})" }]));
    expect((await runChatWithClient(client, [], 'Timer', 'system')).uiComponent).toMatchObject({ type: 'timer', props: { duration: 60 } });
  });
  it('chooses the search tool for explicit research requests', async () => {
    const client = { models: { generateContent: vi.fn().mockResolvedValue(output([{ text: 'Sources follow.' }])) } };
    await runChatWithClient(client, [], 'Search online for exercise guidance', 'system');
    expect(client.models.generateContent.mock.calls[0][0].config.tools).toEqual([{ googleSearch: {} }]);
  });
});

describe('personalization and graceful model failure', () => {
  it('labels sample measurements and includes constraints, memory and exercise inventory', async () => {
    const context: Parameters<typeof buildSystemInstruction>[0] = { date: '2026-10-24', time: '12:00', timezone: 'UTC', timezoneOffset: 0, isAuthenticated: true, userName: 'Fixture', location: { lat: 0, lng: 0 }, fitnessStats: { steps: 100, calories: 20, activeMinutes: 1, stepsGoal: 8000, dataSource: 'simulated' as const }, memoryContext: { goals: [{ type: 'strength', label: 'Build strength', motivation: 'Feel better' }], streaks: [{ habitType: 'workout', currentStreak: 7, longestStreak: 8 }], recentWorkouts: [{ type: 'mobility', completed: true, daysAgo: 0 }], relevantMemories: ['Prefers short sessions'], upcomingEvents: [{ title: 'Training', scheduledAt: '2026-10-25T12:00:00Z' }] }, onboardingState: { stage: 'initial', profileCompleteness: 20, psychologicalState: 'stressed', canAskQuestion: false, healthConditions: ['knee_issue'], totalInteractions: 2, primaryMotivation: 'mobility' } };
    const text = await buildSystemInstruction(context);
    expect(text).toContain('Simulated sample data'); expect(text).toContain('Build strength'); expect(text).toContain('knee_issue'); expect(text).toContain('Plank'); expect(text).toContain('NO questions');
  });
  it('remains usable when exercise inventory or the model is unavailable', async () => {
    vi.mocked(getSupportedExerciseNames).mockRejectedValue(new Error('offline'));
    expect((await buildSystemInstruction()).length).toBeGreaterThan(100);
    model.generateContent.mockRejectedValue(new Error('unavailable'));
    expect(await sendMessageToGemini([], 'Hello')).toHaveProperty('text');
  });
});
