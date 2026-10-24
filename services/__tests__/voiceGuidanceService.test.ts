import { describe, expect, it } from 'vitest';
import { generateGuidanceCues, getGuidanceDuration, getCuesAtTime, adjustCuesForPace, BREATHING_PATTERNS } from '../voiceGuidanceService';

describe('voice cue planning', () => {
  it.each([15, 30, 60, 120, 300])('finishes a %i-second timer on time', work => {
    const cues = generateGuidanceCues({ activity: 'timer', intervals: [{ work, rest: 0 }] });
    expect(cues.at(-1)).toMatchObject({ timing: work * 1000, type: 'completion' });
    expect(cues.every(c => c.timing >= 0 && c.timing <= work * 1000)).toBe(true);
  });
  it.each(Object.keys(BREATHING_PATTERNS))('fits %s breathing to the shared timer', name => {
    const cues = generateGuidanceCues({ activity: 'breathing', pattern: BREATHING_PATTERNS[name], intervals: [{ work: 180, rest: 0 }] });
    expect(getGuidanceDuration(cues)).toBe(180000);
    expect(cues[0].timing).toBe(0);
    expect(cues.at(-1)?.type).toBe('completion');
  });
  it('supplies box breathing when no pattern is selected', () => {
    const cues = generateGuidanceCues({ activity: 'breathing' });
    expect(cues.some(c => c.text.includes('Box Breathing'))).toBe(true);
  });
  it.each(['meditation', 'breathing', 'timer'] as const)('keeps only opening/completion for silent %s', activity => {
    const cues = generateGuidanceCues({ activity, guidanceStyle: 'silent' });
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every(c => c.timing === 0 || c.type === 'completion')).toBe(true);
  });
  it('reduces mindful prompts with light guidance', () => {
    const full = generateGuidanceCues({ activity: 'breathing' });
    const light = generateGuidanceCues({ activity: 'breathing', guidanceStyle: 'light' });
    expect(light.length).toBeLessThanOrEqual(full.length);
    expect(light.at(-1)?.type).toBe('completion');
  });
  it.each(['workout', 'stretching'] as const)('tracks exercise indices for %s', activity => {
    const cues = generateGuidanceCues({ activity, exercises: [
      { name: 'Squat', reps: '8', restAfter: 10 },
      { name: 'Plank', duration: '1 minute', restAfter: 0 },
    ] });
    expect(cues.some(c => c.exerciseIndex === 0)).toBe(true);
    expect(cues.some(c => c.exerciseIndex === 1)).toBe(true);
    expect(cues.at(-1)?.type).toBe('completion');
    expect(cues.every(c => Number.isFinite(c.timing) && c.timing >= 0)).toBe(true);
  });
  it('does not plan an empty workout', () => {
    expect(generateGuidanceCues({ activity: 'workout', exercises: [] })).toEqual([]);
  });
  it('scales cues without changing the originals and filters with tolerance', () => {
    const cues = generateGuidanceCues({ activity: 'timer', intervals: [{ work: 60, rest: 0 }] });
    const original = getGuidanceDuration(cues);
    expect(getGuidanceDuration(adjustCuesForPace(cues, 1.5))).toBe(original * 1.5);
    expect(getGuidanceDuration(cues)).toBe(original);
    expect(getGuidanceDuration([])).toBe(0);
    expect(getCuesAtTime(cues, 60050)).toContainEqual(cues.at(-1));
    expect(getCuesAtTime(cues, 60101)).toEqual([]);
  });
});
