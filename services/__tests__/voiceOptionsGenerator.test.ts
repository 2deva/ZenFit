import { describe, expect, it } from 'vitest';
import { generateVoiceOptions, generateVoicePrompt, enhanceWithVoiceOptions } from '../voiceOptionsGenerator';
import { processToolInterceptors } from '../toolMiddleware';

describe('spoken UI selection contracts', () => {
  it('preserves exercise data when creating workout actions', () => {
    const props = { title: 'Return workout', exercises: [{ name: 'Plank', duration: '30s' }] };
    const result = enhanceWithVoiceOptions('workoutList', props);
    expect(result.voiceOptions?.[0]).toMatchObject({ id: 'start_guided', data: { exercises: props.exercises } });
    expect(result.voicePrompt?.fullPrompt).toContain('Plank'); expect(props).not.toHaveProperty('voiceOptions');
  });
  it('announces builder and goal choices with stable IDs', () => {
    const props = { categories: [{ id: 'focus', label: 'Focus', options: [{ id: 'strength', label: 'Strength' }, { id: 'calm', label: 'Calm' }] }] };
    const options = generateVoiceOptions('workoutBuilder', props)!;
    expect(options[0]).toMatchObject({ id: 'strength', index: 0, data: { categoryId: 'focus' } });
    expect(generateVoicePrompt('workoutBuilder', props, options).fullPrompt).toContain('Strength');
    const goals = generateVoiceOptions('goalSelector', { options: [{ id: 'morning-workout', label: 'Morning Workout' }] })!;
    expect(goals[0].synonyms).toContain('morning workout');
    expect(generateVoicePrompt('goalSelector', {}, goals).fullPrompt).toContain('Morning Workout');
  });
  it('uses seconds consistently for timers', () => {
    const result = enhanceWithVoiceOptions('timer', { label: 'Reset', duration: 90 });
    expect(result.voicePrompt?.fullPrompt).toContain('1 minute 30 seconds');
    expect(result.voiceOptions?.[0].data).toMatchObject({ duration: 90 });
    expect(enhanceWithVoiceOptions('timer', { duration: 15 }).voicePrompt?.fullPrompt).toContain('15 seconds');
  });
  it('does not invent options for unsupported or empty components', () => {
    expect(generateVoiceOptions('chart', {})).toBeNull();
    expect(generateVoiceOptions('workoutList', { exercises: [] })).toEqual([]);
    expect(generateVoiceOptions('workoutBuilder', { categories: [] })).toEqual([]);
    expect(generateVoiceOptions('goalSelector', { options: [] })).toEqual([]);
    const props = { data: [] }; expect(enhanceWithVoiceOptions('chart', props)).toEqual({ props, voiceOptions: undefined });
  });
  it('preserves provided voice options and enhances only missing UI options', () => {
    const supplied = [{ id: 'a', label: 'A', index: 0 }];
    expect(processToolInterceptors('renderUI', { type: 'timer', props: { voiceOptions: supplied } })).toMatchObject({ wasEnhanced: false, voiceOptions: supplied });
    expect(processToolInterceptors('renderUI', { type: 'timer', props: { duration: 60 } }).wasEnhanced).toBe(true);
    expect(processToolInterceptors('otherTool', { type: 'timer', props: {} }).wasEnhanced).toBe(false);
  });
});
