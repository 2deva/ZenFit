/** Owns pending timeouts so lifecycle changes can cancel cues before they fire. */
export class GuidanceScheduler<T> {
  private timers = new Map<ReturnType<typeof setTimeout>, { cue: T; scheduledFor: number }>();

  get pending(): Array<{ cue: T; scheduledFor: number }> {
    return [...this.timers.values()];
  }

  schedule(cue: T, delay: number, callback: () => void): void {
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError('Delay must be finite and non-negative');
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.set(timer, { cue, scheduledFor: Date.now() + delay });
  }

  cancel(predicate: (cue: T) => boolean = () => true): void {
    for (const [timer, entry] of this.timers) {
      if (predicate(entry.cue)) {
        clearTimeout(timer);
        this.timers.delete(timer);
      }
    }
  }
}
