import { useCallback, useRef } from 'react';

/** Audio resources have a separate lifecycle from the Live session protocol. */
export function useLiveSessionAudio() {
  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // On some mobile browsers, playing audio while the mic is active can route audio to the earpiece.
  // A common workaround is to route WebAudio output through a media element.
  // This is best-effort only (platform limitations apply).
  const outputStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const outputAudioElRef = useRef<HTMLAudioElement | null>(null);
  const useMediaElementOutputRef = useRef<boolean>(false);

  const ensureMobileSpeakerOutput = useCallback(async (ctx: AudioContext) => {
    // Only attempt on mobile-ish UAs; keep desktop behavior unchanged.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    if (!isMobile) {
      useMediaElementOutputRef.current = false;
      return;
    }

    try {
      // Lazily create a MediaStream destination and pipe it through a hidden <audio>.
      if (!outputStreamDestRef.current) {
        outputStreamDestRef.current = ctx.createMediaStreamDestination();
      }

      if (!outputAudioElRef.current) {
        const el = document.createElement('audio');
        el.autoplay = true;
        // @ts-expect-error - playsInline exists on iOS Safari but isn't in all TS lib defs.
        el.playsInline = true;
        el.setAttribute('playsinline', 'true');
        el.muted = false;
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.opacity = '0';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        outputAudioElRef.current = el;
      }

      const el = outputAudioElRef.current!;
      if (el.srcObject !== outputStreamDestRef.current!.stream) {
        el.srcObject = outputStreamDestRef.current!.stream;
      }

      // If this fails due to autoplay restrictions, we fall back to direct output.
      await el.play();
      useMediaElementOutputRef.current = true;
    } catch {
      useMediaElementOutputRef.current = false;
    }
  }, []);

  const cleanupAudio = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current.port.close();
      workletNodeRef.current = null;
    }

    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }

    if (inputContextRef.current) {
      if (inputContextRef.current.state !== 'closed') inputContextRef.current.close();
      inputContextRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'running') {
        audioContextRef.current.suspend().catch(() => { });
      }
      audioContextRef.current = null;
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch { /* Best effort: the resource may already be released. */ }
    });
    sourcesRef.current.clear();

    // Best-effort cleanup for mobile audio routing hack
    useMediaElementOutputRef.current = false;
    if (outputAudioElRef.current) {
      try {
        outputAudioElRef.current.pause();
        outputAudioElRef.current.srcObject = null;
        outputAudioElRef.current.remove();
      } catch { /* ignore */ }
      outputAudioElRef.current = null;
    }
    outputStreamDestRef.current = null;
  }, []);

  return { audioContextRef, inputContextRef, inputSourceRef, workletNodeRef, streamRef, nextStartTimeRef, sourcesRef, outputStreamDestRef, outputAudioElRef, useMediaElementOutputRef, ensureMobileSpeakerOutput, cleanupAudio };
}
