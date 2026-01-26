
import React, { useEffect, useRef } from 'react';
import { Button } from './ui/Button';
import { Mic, MicOff, X, Activity, Square } from 'lucide-react';
import { LiveStatus } from '../types';

interface VoiceControlsProps {
  status: LiveStatus;
  onToggle: () => void;
  audioDataRef?: React.MutableRefObject<Float32Array>;
  isInterrupted?: boolean;
  variant?: 'overlay' | 'inline';
  // Mute control
  isMuted?: boolean;
  onMuteToggle?: () => void;
}

export const VoiceControls: React.FC<VoiceControlsProps> = ({
  status,
  onToggle,
  audioDataRef,
  isInterrupted,
  variant = 'overlay',
  isMuted = false,
  onMuteToggle
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (status !== LiveStatus.CONNECTED) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const animate = () => {
      if (canvasRef.current && audioDataRef?.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          const gradient = ctx.createLinearGradient(0, 0, width, 0);

          if (isInterrupted) {
            gradient.addColorStop(0, '#F87171');
            gradient.addColorStop(1, '#DC2626');
          } else {
            gradient.addColorStop(0, '#E87A38');
            gradient.addColorStop(1, '#D96922');
          }
          ctx.fillStyle = gradient;

          const barWidth = 3;
          const gap = 3;
          const audioData = audioDataRef.current;
          const dataStep = Math.floor(audioData.length / (width / (barWidth + gap)));

          for (let i = 0; i < width; i += (barWidth + gap)) {
            const dataIndex = Math.floor(i / (barWidth + gap)) * dataStep;
            const value = Math.abs(audioData[dataIndex] || 0);
            const barHeight = Math.max(4, Math.min(height, value * height * 4));

            const x = i;
            const y = (height - barHeight) / 2;

            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 6);
            ctx.fill();
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [status, isInterrupted, audioDataRef]);

  if (status === LiveStatus.DISCONNECTED && !audioDataRef?.current && variant === 'overlay') return null;

  const overlayClasses = `fixed bottom-20 sm:bottom-28 left-1/2 transform -translate-x-1/2 z-40 transition-all duration-500 ease-out ${status === LiveStatus.DISCONNECTED ? 'opacity-0 translate-y-10 pointer-events-none' : 'opacity-100 translate-y-0'}`;
  const inlineClasses = `relative w-full mx-auto z-40 transition-all duration-500 ease-out ${status === LiveStatus.DISCONNECTED ? 'opacity-0 scale-95 pointer-events-none absolute' : 'opacity-100 scale-100'}`;

  const containerClasses = variant === 'overlay' ? overlayClasses : inlineClasses;

  return (
    <div className={containerClasses}>
      <div className={`
                relative px-4 sm:px-6 py-3 sm:py-4 rounded-2xl sm:rounded-[28px] flex items-center justify-between space-x-3 sm:space-x-6 transition-all duration-500 w-full
                ${isInterrupted
          ? 'bg-red-50 backdrop-blur-xl border border-red-200 shadow-xl'
          : 'bg-white/95 backdrop-blur-xl border border-claude-200 shadow-xl shadow-claude-500/10'}
            `}>

        {/* Status Indicator */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <div className="relative">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${isInterrupted ? 'bg-red-400 animate-ping' : 'bg-claude-400 animate-breathe'}`}></span>
            <div className={`relative rounded-full p-2 sm:p-2.5 transition-all duration-300 ${isInterrupted ? 'bg-gradient-to-br from-red-500 to-red-600' : 'bg-gradient-to-br from-claude-500 to-claude-600'}`}>
              {isInterrupted ? <Square className="w-3 h-3 sm:w-4 sm:h-4 text-white fill-white" /> : <Activity className="w-3 h-3 sm:w-4 sm:h-4 text-white" />}
            </div>
          </div>
          <div className="flex flex-col w-16 sm:w-24">
            <span className="font-display text-xs sm:text-sm font-bold text-ink-800 uppercase tracking-wide">
              {isInterrupted ? 'Halted' : 'Live'}
            </span>
            <span className={`text-[9px] sm:text-[11px] font-body font-medium truncate ${isInterrupted ? 'text-red-500' : 'text-ink-400'}`}>
              {isInterrupted ? 'Interrupted' : (status === 'connecting' ? 'Connecting...' : 'Listening')}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 sm:h-10 w-px bg-gradient-to-b from-transparent via-sand-300 to-transparent"></div>

        {/* Audio Visualization - Flexible width */}
        <div className="flex-1 flex justify-center">
          <canvas ref={canvasRef} width={100} height={28} className="w-full max-w-[140px] h-7 sm:h-9" />
        </div>

        {/* Mute Button */}
        {onMuteToggle && (
          <Button
            variant={isMuted ? "danger" : "secondary"}
            size="icon"
            onClick={onMuteToggle}
            className={`rounded-full h-9 w-9 sm:h-11 sm:w-11 transition-all duration-300 hover:scale-110 flex-shrink-0 ${isMuted ? 'bg-red-100 border-red-300 hover:bg-red-200' : ''
              }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? (
              <MicOff className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
            ) : (
              <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
            )}
          </Button>
        )}

        {/* Close Button */}
        <Button
          variant="danger"
          size="icon"
          onClick={onToggle}
          className={`rounded-full h-9 w-9 sm:h-11 sm:w-11 transition-all duration-300 hover:scale-110 flex-shrink-0`}
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>

        {/* Glow Effect */}
        <div className={`absolute -inset-1 rounded-[24px] sm:rounded-[32px] blur-xl transition-opacity duration-500 pointer-events-none ${isInterrupted ? 'bg-red-200/30 opacity-100' : 'bg-claude-200/20 opacity-60'}`}></div>
      </div>
    </div>
  );
};
