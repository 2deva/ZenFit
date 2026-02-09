export type MindfulIntent = 'breathing_reset' | 'deep_meditation' | 'sleep_prep' | 'focus_block';

export function isMindfulIntent(intent?: string | null): intent is MindfulIntent {
  return intent === 'breathing_reset'
    || intent === 'deep_meditation'
    || intent === 'sleep_prep'
    || intent === 'focus_block';
}

export function shouldUseSharedNumericCountdown(sessionType?: string, intent?: string | null): boolean {
  if (sessionType !== 'timer') return false;
  return !isMindfulIntent(intent);
}
