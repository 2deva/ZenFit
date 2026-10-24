import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveSession } from '../useLiveSession';
import { ai } from '../../services/opikGemini';
import { LiveStatus } from '../../types';
import { resetAudioContext } from '../../utils/audioUtils';
import { generateSessionSummary } from '../../services/liveSessionMemoryService';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ accessToken: 'fixture-token' }) }));
vi.mock('../../supabaseConfig', () => ({ supabase: null, isSupabaseConfigured: false }));
vi.mock('../../services/opikGemini', () => ({ ai: { live: { connect: vi.fn() }, models: { generateContent: vi.fn() } } }));
vi.mock('../../services/liveSessionMemoryService', () => ({
  bufferTranscript: vi.fn(), clearSessionBuffer: vi.fn(), extractFromTranscription: vi.fn(),
  extractAndStoreSessionSummary: vi.fn().mockResolvedValue(null),
  generateSessionSummary: vi.fn().mockResolvedValue(null), getSessionTranscripts: vi.fn().mockReturnValue([]),
}));
class FakeContext {
  state = 'running'; destination = {}; currentTime = 0;
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
}
class FakeWorklet {
  port = { onmessage: null, close: vi.fn() }; connect = vi.fn(); disconnect = vi.fn();
}
let callbacks: { onopen: () => void; onmessage: (message: unknown) => void; onclose: () => void; onerror: (e: unknown) => void };
let track: { stop: ReturnType<typeof vi.fn> };
let session: { close: ReturnType<typeof vi.fn>; sendClientContent: ReturnType<typeof vi.fn>; sendRealtimeInput: ReturnType<typeof vi.fn> };
const stream = () => ({ getTracks: () => [track] }) as unknown as MediaStream;
const getUserMedia = vi.fn();
const revokeObjectURL = vi.fn();
const props = () => ({ onTranscription: vi.fn(), onError: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  track = { stop: vi.fn() }; session = { close: vi.fn(), sendClientContent: vi.fn(), sendRealtimeInput: vi.fn() };
  vi.stubGlobal('AudioContext', FakeContext); vi.stubGlobal('AudioWorkletNode', FakeWorklet);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  getUserMedia.mockResolvedValue(stream());
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
  vi.mocked(generateSessionSummary).mockResolvedValue(null);
  vi.mocked(ai.live.connect).mockImplementation(async options => { callbacks = options.callbacks as unknown as typeof callbacks; return session as never; });
});
afterEach(async () => { await resetAudioContext(); vi.unstubAllGlobals(); });
async function open(result: { current: ReturnType<typeof useLiveSession> }) {
  await act(async () => result.current.connect());
  await act(async () => callbacks.onopen());
  await waitFor(() => expect(result.current.status).toBe(LiveStatus.CONNECTED));
}
describe('live voice connection lifecycle', () => {
  it('opens, sends only when ready, and releases microphone before slow logging', async () => {
    const { result } = renderHook(() => useLiveSession(props()));
    act(() => result.current.sendMessageToLive('too early')); expect(session.sendClientContent).not.toHaveBeenCalled();
    await open(result); act(() => result.current.sendMessageToLive('hello'));
    expect(session.sendClientContent).toHaveBeenCalledWith(expect.objectContaining({ turns: [{ role: 'user', parts: [{ text: 'hello' }] }] }));
    let finish!: (value: null) => void;
    vi.mocked(generateSessionSummary).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let disconnect!: Promise<void>;
    act(() => { disconnect = result.current.disconnect(); });
    expect(track.stop).toHaveBeenCalledTimes(1); expect(result.current.status).toBe(LiveStatus.DISCONNECTED);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
    act(() => result.current.sendMessageToLive('after close')); expect(session.sendClientContent).toHaveBeenCalledTimes(1);
    await act(async () => { finish(null); await disconnect; }); expect(session.close).toHaveBeenCalledTimes(1);
  });
  it.each([['NotAllowedError', 'PERMISSION_DENIED'], ['NotFoundError', 'NO_DEVICE']])('reports %s without opening a model connection', async (name, code) => {
    getUserMedia.mockRejectedValueOnce(new DOMException('microphone unavailable', name));
    const p = props(); const { result } = renderHook(() => useLiveSession(p));
    await act(async () => result.current.connect());
    expect(result.current.status).toBe(LiveStatus.DISCONNECTED); expect(p.onError).toHaveBeenCalledWith(code, expect.any(String));
    expect(ai.live.connect).not.toHaveBeenCalled();
  });
  it('handles rejected SDK connection and stops the acquired microphone', async () => {
    vi.mocked(ai.live.connect).mockRejectedValueOnce(new Error('offline'));
    const p = props(); const { result } = renderHook(() => useLiveSession(p));
    await act(async () => result.current.connect());
    expect(result.current.status).toBe(LiveStatus.DISCONNECTED); expect(track.stop).toHaveBeenCalledTimes(1);
    expect(p.onError).toHaveBeenCalledWith('CONNECTION_FAILED', expect.any(String));
  });
  it('stops permission results that arrive after cancellation', async () => {
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useLiveSession(props())); let connecting!: Promise<void>;
    await act(async () => { connecting = result.current.connect(); });
    await act(async () => result.current.disconnect());
    await act(async () => { resolve(stream()); await connecting; });
    expect(track.stop).toHaveBeenCalledTimes(1); expect(ai.live.connect).not.toHaveBeenCalled();
    expect(result.current.status).toBe(LiveStatus.DISCONNECTED);
  });
  it('ignores events from a previous connection after reconnecting', async () => {
    const p = props(); const { result } = renderHook(() => useLiveSession(p));
    await open(result); const old = callbacks;
    await act(async () => result.current.disconnect()); await open(result);
    await act(async () => { old.onopen(); old.onerror(new Error('stale')); old.onclose(); old.onmessage({ serverContent: { inputTranscription: { text: 'stale' } } }); });
    expect(result.current.status).toBe(LiveStatus.CONNECTED); expect(p.onError).not.toHaveBeenCalled(); expect(p.onTranscription).not.toHaveBeenCalled();
    await act(async () => result.current.disconnect());
  });
  it('reports send failures while keeping the connection available', async () => {
    const p = props(); const { result } = renderHook(() => useLiveSession(p)); await open(result);
    session.sendClientContent.mockImplementationOnce(() => { throw new Error('send failed'); });
    act(() => result.current.sendMessageToLive('hello'));
    expect(p.onError).toHaveBeenCalledWith('SEND_MESSAGE_FAILED', expect.any(String));
    expect(result.current.status).toBe(LiveStatus.CONNECTED); await act(async () => result.current.disconnect());
  });
});
