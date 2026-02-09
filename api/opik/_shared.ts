export function inferIntent(text: string): string {
  const t = (text || "").toLowerCase();
  if (/(missed|miss|streak|fell off|fallen off|restart|get back|back on track|quit)/.test(t)) return "reengage";
  if (/(stress|anxious|overwhelm|overwhelmed|panic|burnout)/.test(t)) return "stress";
  if (/(tired|exhausted|low energy|no time|short|quick)/.test(t)) return "low_energy";
  if (/(progress|how am i doing|stats|chart|dashboard)/.test(t)) return "progress";
  if (/(breath|breathing|meditat|calm|relax)/.test(t)) return "mindfulness";
  if (/(workout|exercise|training|routine|timer)/.test(t)) return "workout";
  return "general";
}

export function inferUserState(text: string): string {
  const t = (text || "").toLowerCase();
  if (/(stressed|anxious|overwhelmed|panic|burnout)/.test(t)) return "stressed";
  if (/(tired|exhausted|drained|no energy)/.test(t)) return "low_energy";
  if (/(idk|not sure|whatever|ok|fine)/.test(t)) return "hesitant";
  if (/(let's go|ready|start|do it|now)/.test(t)) return "action_oriented";
  return "neutral";
}

export function normalizeTurns(
  transcripts: Array<{ text: string; isUser: boolean; timestamp?: number; isFinal?: boolean }> = []
): Array<{ role: "user" | "assistant"; text: string; timestamp?: number; final?: boolean }> {
  return transcripts
    .filter(t => t && t.text && t.text.trim().length > 0)
    .map(t => ({
      role: t.isUser ? "user" : "assistant",
      text: t.text,
      timestamp: t.timestamp,
      final: t.isFinal
    }));
}
