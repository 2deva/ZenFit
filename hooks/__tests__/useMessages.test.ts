import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessages } from '../useMessages';
import { MessageRole } from '../../types';
import { getMessages, saveMessage } from '../../services/supabaseService';
import { syncService } from '../../services/syncService';
import * as storage from '../../services/storageService';
import { messageHistoryKey } from '../../services/messageHistory';
vi.mock('../../supabaseConfig', () => ({ supabase: {}, isSupabaseConfigured: false }));
vi.mock('../../services/supabaseService', () => ({ getMessages: vi.fn(), saveMessage: vi.fn(), deleteAllMessages: vi.fn() }));
vi.mock('../../services/syncService', () => ({ syncService: { scheduleOperation: vi.fn() } }));
const message = { id: 'm1', role: MessageRole.USER, text: 'Ready', timestamp: 1 };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(getMessages).mockResolvedValue([]); vi.mocked(saveMessage).mockResolvedValue(true); });

describe('chat message persistence', () => {
  it('keeps unsynced local messages when cloud records arrive', async () => {
    storage.setStorageItem(messageHistoryKey('user'), [{ ...message, id: 'local' }]);
    vi.mocked(getMessages).mockResolvedValue([{ message_id: 'cloud', role: 'user', text: 'Cloud', timestamp: 2 }] as never);
    const { result } = renderHook(() => useMessages({ supabaseUserId: 'user' }));
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.messages.map(m => m.id)).toEqual(['local', 'cloud']);
    await waitFor(() => expect(syncService.scheduleOperation).toHaveBeenCalledWith('SAVE_MESSAGE', expect.objectContaining({ message: expect.objectContaining({ id: 'local' }) })), { timeout: 1500 });
  });
  it('does not expose or upload another account or guest history on identity changes', async () => {
    storage.setMessages([{ ...message, id: 'guest' }]);
    storage.setStorageItem(messageHistoryKey('alice'), [{ ...message, id: 'alice' }]);
    const { result, rerender } = renderHook(({ userId }) => useMessages({ supabaseUserId: userId }), { initialProps: { userId: 'alice' } });
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.messages.map(m => m.id)).toEqual(['alice']);
    rerender({ userId: 'bob' }); await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.messages).toEqual([]);
    expect(storage.getMessages().map(m => m.id)).toEqual(['guest']);
  });

  it('restores local messages and persists new messages after debounce', async () => {
    storage.setMessages([message]); const { result } = renderHook(() => useMessages({ supabaseUserId: null }));
    await waitFor(() => expect(result.current.isInitialized).toBe(true)); expect(result.current.messages).toEqual([message]);
    act(() => result.current.addMessage({ ...message, id: 'm2', text: 'Begin' }));
    await waitFor(() => expect(storage.getMessages()).toHaveLength(2), { timeout: 1500 });
  });
  it('schedules new chat messages while keeping guidance local', async () => {
    const { result } = renderHook(() => useMessages({ supabaseUserId: 'user' }));
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    act(() => { result.current.addMessage(message); result.current.addMessage({ ...message, id: 'guidance', messageContext: 'workout_guidance' }); });
    await waitFor(() => expect(syncService.scheduleOperation).toHaveBeenCalledWith('SAVE_MESSAGE', expect.objectContaining({ message: expect.objectContaining({ id: 'm1' }) })), { timeout: 1500 });
    expect(vi.mocked(syncService.scheduleOperation).mock.calls.some(([, payload]) => 'message' in payload && payload.message.id === 'guidance')).toBe(false);
  });
  it('filters cloud guidance and preserves local UI metadata', async () => {
    storage.setStorageItem(messageHistoryKey('user'), [{ ...message, uiComponent: { type: 'timer', props: { duration: 60 } } }]);
    vi.mocked(getMessages).mockResolvedValue([
      { message_id: 'hidden', message_context: 'workout_guidance', role: 'model', text: 'Go!', timestamp: 2 },
      { message_id: 'm1', role: 'user', text: 'Ready', timestamp: 1 },
    ] as never);
    const { result } = renderHook(() => useMessages({ supabaseUserId: 'user' }));
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.messages).toHaveLength(1); expect(result.current.messages[0].uiComponent?.type).toBe('timer');
  });
  it('clears local history and schedules authenticated deletion', async () => {
    const { result } = renderHook(() => useMessages({ supabaseUserId: 'user' })); await waitFor(() => expect(result.current.isInitialized).toBe(true));
    act(() => result.current.addMessage(message)); await act(async () => result.current.clearMessages());
    expect(result.current.messages).toEqual([]); expect(storage.getMessages()).toEqual([]); expect(syncService.scheduleOperation).toHaveBeenCalledWith('DELETE_MESSAGES', { userId: 'user' });
  });
});
