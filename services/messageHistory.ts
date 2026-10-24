import type { Message } from '../types';
import { STORAGE_KEYS } from '../constants/app';
export function messageHistoryKey(userId: string | null): string {
  return userId ? `zenfit_messages_user_${userId}` : STORAGE_KEYS.MESSAGES;
}
/** Keep unsynced local messages and local UI metadata while merging cloud records. */
export function mergeMessageHistory(local: Message[], cloud: Message[]): Message[] {
  const merged = new Map(local.map(message => [message.id, message]));
  for (const message of cloud) {
    const existing = merged.get(message.id);
    merged.set(message.id, { ...existing, ...message,
      uiComponent: message.uiComponent || existing?.uiComponent,
      messageContext: message.messageContext || existing?.messageContext,
      relatedWorkoutId: message.relatedWorkoutId || existing?.relatedWorkoutId,
      groundingChunks: message.groundingChunks || existing?.groundingChunks,
    });
  }
  return [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
}
