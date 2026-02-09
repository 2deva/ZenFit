const READINESS_PHRASES = new Set([
  'ready',
  "i'm ready",
  'i am ready',
  "let's go",
  'lets go',
  'go',
  'start',
  'begin',
  'okay start',
  'ok start',
  'yes',
  'yes i am ready'
]);

function normalizeUtterance(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isIntentSafeReadinessUtterance(input: string): boolean {
  const normalized = normalizeUtterance(input);
  if (!normalized) return false;
  // Intentionally strict: only accept direct readiness utterances.
  return READINESS_PHRASES.has(normalized);
}
