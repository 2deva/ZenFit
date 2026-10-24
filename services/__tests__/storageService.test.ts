import { describe, expect, it, vi } from 'vitest';
import * as storage from '../storageService';
import { STORAGE_KEYS } from '../../constants/app';
import { MessageRole } from '../../types';
describe('local storage boundaries', () => {
  it('roundtrips independent state categories and clears only app records', () => {
    const messages = [{ id: 'm1', role: MessageRole.USER, text: 'Ready', timestamp: 1 }];
    expect(storage.setMessages(messages)).toBe(true); expect(storage.getMessages()).toEqual(messages);
    storage.setProfile({ name: 'Evaluation user', goals: ['strength'] }); expect(storage.getProfile()?.goals).toEqual(['strength']);
    storage.setWorkoutProgress('w1', { completed: [0] }); expect(storage.getWorkoutProgress('w1')).toEqual({ completed: [0] });
    storage.setAppState({ activeTimer: null, currentWorkoutProgress: null, lastGeneratedWorkout: null, recentUIInteractions: [], timestamp: 1 }); expect(storage.getAppState()?.timestamp).toBe(1);
    storage.setSyncQueue([{ id: 'queued' }]); expect(storage.getSyncQueue()).toEqual([{ id: 'queued' }]);
    localStorage.setItem('unrelated', 'keep'); localStorage.setItem(STORAGE_KEYS.LEGACY_CHAT_HISTORY, 'old');
    storage.clearAllStorage();
    expect(storage.getMessages()).toEqual([]); expect(storage.getProfile()).toBeNull(); expect(storage.getWorkoutProgress('w1')).toBeNull(); expect(storage.getSyncQueue()).toEqual([]);
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
  it('returns defaults for missing, malformed and unavailable storage', () => {
    expect(storage.getStorageItem('missing', 42)).toBe(42);
    localStorage.setItem('broken', 'not-json'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(storage.getStorageItem('broken', [])).toEqual([]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(storage.getStorageItem('key', 'fallback')).toBe('fallback');
  });
  it('reports writes that fail and tolerates denied deletions', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(storage.setStorageItem('key', {})).toBe(false);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => storage.removeStorageItem('key')).not.toThrow();
  });
});
