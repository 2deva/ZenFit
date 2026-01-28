/**
 * Normalize timer props from LLM/tool calls so duration is always in seconds and sensible.
 * Fixes: "1 min" requests showing 5:00 when model sends 300 or omits duration.
 */

const ONE_MIN_SECONDS = 60;
const FIVE_MIN_SECONDS = 300;

/** Matches "1 min", "one minute", "1min", etc. */
const ONE_MIN_PATTERN = /\b(1|one)\s*min(ute)?s?\b/i;

export function normalizeTimerProps(
  props: { duration?: number; label?: string; [k: string]: unknown },
  userMessageHint?: string
): { duration: number; label: string; [k: string]: unknown } {
  let duration = typeof props.duration === 'number' && props.duration > 0
    ? props.duration
    : ONE_MIN_SECONDS;

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
