type MindfulIntent = 'breathing_reset' | 'deep_meditation' | 'sleep_prep' | 'focus_block';

export interface MindfulTimerResolution {
  activityType: 'breathing' | 'meditation' | null;
  intent?: MindfulIntent;
  guidanceStyle?: 'full' | 'light' | 'silent';
  pattern?: 'box' | '4-7-8' | 'calming' | 'energizing';
  phases?: Array<{
    id: string;
    kind: 'settle' | 'breath_cycle' | 'body_scan' | 'meditation' | 'closing';
    durationSeconds: number;
    order: number;
  }>;
}

export function resolveMindfulTimer(timerProps: any): MindfulTimerResolution {
  const label = (timerProps?.label || '').toString();
  const labelLower = label.toLowerCase();
  const meta = timerProps?.meta || {};
  const mindfulConfig = meta?.mindfulConfig;
  const phases = meta?.phases;

  if (mindfulConfig) {
    const intent = mindfulConfig.intent as MindfulIntent | undefined;
    const pattern = mindfulConfig.pattern as MindfulTimerResolution['pattern'] | undefined;

    if (intent === 'breathing_reset' || pattern) {
      return {
        activityType: 'breathing',
        intent,
        guidanceStyle: mindfulConfig.guidanceStyle,
        pattern,
        phases
      };
    }

    return {
      activityType: 'meditation',
      intent,
      guidanceStyle: mindfulConfig.guidanceStyle,
      phases
    };
  }

  const isBreathing = labelLower.includes('breathing') || labelLower.includes('breath');
  if (isBreathing) {
    return { activityType: 'breathing', phases };
  }

  const isMeditation =
    labelLower.includes('meditation') ||
    labelLower.includes('mindful') ||
    labelLower.includes('calm') ||
    labelLower.includes('sleep');

  if (isMeditation) {
    return { activityType: 'meditation', phases };
  }

  return { activityType: null };
}

