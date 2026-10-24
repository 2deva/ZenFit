import { describe, expect, it } from 'vitest';
import { arrayBufferToBase64, base64ToUint8Array, createPcmBlob, decodeAudioData } from '../audioUtils';

const audioContext = () => ({ createBuffer: (channels: number, frames: number, sampleRate: number) => {
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  return { sampleRate, length: frames, getChannelData: (channel: number) => data[channel] };
} }) as unknown as AudioContext;

describe('PCM audio conversion', () => {
  it('roundtrips binary bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(base64ToUint8Array(arrayBufferToBase64(bytes.buffer))).toEqual(bytes);
  });
  it('clamps float samples to the signed PCM range', () => {
    const blob = createPcmBlob(new Float32Array([-2, -1, 0, 1, 2]));
    expect(blob.mimeType).toBe('audio/pcm;rate=16000');
    const pcm = new Int16Array(base64ToUint8Array(blob.data).buffer);
    expect([...pcm]).toEqual([-32768, -32768, 0, 32767, 32767]);
  });
  it('decodes only the supplied view, including unaligned offsets', async () => {
    const buffer = new Uint8Array([99, 0, 128, 0, 0, 255, 127, 99]);
    const audio = await decodeAudioData(buffer.subarray(1, 7), audioContext());
    expect(audio.length).toBe(3);
    expect([...audio.getChannelData(0)]).toEqual([-1, 0, 32767 / 32768]);
  });
  it('deinterleaves stereo frames', async () => {
    const samples = new Int16Array([0, 16384, -32768, 32767]);
    const audio = await decodeAudioData(new Uint8Array(samples.buffer), audioContext(), 24000, 2);
    expect([...audio.getChannelData(0)]).toEqual([0, -1]);
    expect([...audio.getChannelData(1)]).toEqual([0.5, 32767 / 32768]);
  });
  it.each([0, -1, 1.5, 2])('rejects incomplete frames or invalid channel count %s', channels => {
    return expect(decodeAudioData(new Uint8Array(3), audioContext(), 24000, channels)).rejects.toThrow(RangeError);
  });
});
