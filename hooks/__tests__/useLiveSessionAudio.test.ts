import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveSessionAudio } from '../useLiveSessionAudio';

describe('Live audio lifecycle', () => {
  it('releases microphone tracks, worklets, contexts and playback nodes', () => {
    const { result } = renderHook(useLiveSessionAudio);
    const refs = result.current;
    const stop = vi.fn(); const disconnect = vi.fn(); const close = vi.fn(); const suspend = vi.fn().mockResolvedValue(undefined);
    refs.streamRef.current = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    refs.workletNodeRef.current = { disconnect, port: { close } } as unknown as AudioWorkletNode;
    refs.inputSourceRef.current = { disconnect } as unknown as MediaStreamAudioSourceNode;
    refs.inputContextRef.current = { state: 'running', close } as unknown as AudioContext;
    refs.audioContextRef.current = { state: 'running', suspend } as unknown as AudioContext;
    refs.sourcesRef.current.add({ stop } as unknown as AudioBufferSourceNode);
    refs.cleanupAudio(); refs.cleanupAudio();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(suspend).toHaveBeenCalledOnce();
    expect(refs.sourcesRef.current.size).toBe(0);
    expect(refs.streamRef.current).toBeNull();
    expect(refs.audioContextRef.current).toBeNull();
  });
  it('keeps direct audio output on desktop', async () => {
    const { result } = renderHook(useLiveSessionAudio);
    const createMediaStreamDestination = vi.fn();
    await result.current.ensureMobileSpeakerOutput({ createMediaStreamDestination } as unknown as AudioContext);
    expect(createMediaStreamDestination).not.toHaveBeenCalled();
    expect(result.current.useMediaElementOutputRef.current).toBe(false);
  });
});
