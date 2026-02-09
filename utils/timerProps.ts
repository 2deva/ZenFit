/**
 * Normalize timer props from LLM/tool calls so duration is always in seconds and sensible.
 * Fixes: "1 min" requests showing 5:00 when model sends 300 or omits duration.
 * Fixes: model says "5-minute" in reply but sends 60 — align duration to stated minutes.
 */

const ONE_MIN_SECONDS = 60;
const FIVE_MIN_SECONDS = 300;

/** Matches "1 min", "one minute", "1min", etc. */
const ONE_MIN_PATTERN = /\b(1|one)\s*min(ute)?s?\b/i;

/** Matches "N min" or "N minute(s)" in assistant text to align duration with what was stated. */
const STATED_MINUTES_PATTERN = /\b(\d+)\s*min(ute)?s?\b/i;

export function normalizeTimerProps(
  props: { duration?: number; label?: string; [k: string]: unknown },
  userMessageHint?: string,
  assistantText?: string
): { duration: number; label: string; [k: string]: unknown } {
  let duration = typeof props.duration === 'number' && props.duration > 0
    ? props.duration
    : ONE_MIN_SECONDS;

  // Assistant said "N min" in reply but sent wrong duration — align so UI matches stated length
  if (assistantText) {
    const stated = assistantText.match(STATED_MINUTES_PATTERN)?.[1];
    const statedMinutes = stated ? parseInt(stated, 10) : null;
    if (statedMinutes != null && statedMinutes >= 1 && statedMinutes <= 60) {
      const expectedSeconds = statedMinutes * 60;
      if (duration !== expectedSeconds) duration = expectedSeconds;
    }
  }

  // User said "1 min" but model sent 5 min (300) — correct it
  if (userMessageHint && ONE_MIN_PATTERN.test(userMessageHint) && duration === FIVE_MIN_SECONDS) {
    duration = ONE_MIN_SECONDS;
  }

  return {
    ...props,
    duration,
    label: props.label ?? 'Timer'
  };
}
