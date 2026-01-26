import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/Button';
import { Play, Pause, RotateCcw, CheckCircle2, Timer as TimerIcon, Volume2, Mic, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface TimerProps {
  durationSeconds?: number;
  label?: string;
  onStateChange?: (state: { label: string; totalSeconds: number; remainingSeconds: number; isRunning: boolean }) => void;

  // Controlled state (for syncing with guidance)
  controlledIsRunning?: boolean;
  controlledTimeLeft?: number;

  // Live Mode Integration
  isLiveMode?: boolean;
  audioDataRef?: React.MutableRefObject<Float32Array>;
  aiState?: 'listening' | 'speaking' | 'processing' | 'idle';
  currentGuidanceText?: string;
  onLiveControl?: (action: 'pause' | 'resume' | 'skip' | 'back') => void;

  // Guidance Messages
  guidanceMessages?: Array<{ id: string; text: string; timestamp: number }>;
}

export const Timer: React.FC<TimerProps> = ({
  durationSeconds = 60,
  label = 'Timer',
  onStateChange,
  controlledIsRunning,
  controlledTimeLeft,
  isLiveMode = false,
  audioDataRef,
  aiState = 'idle',
  currentGuidanceText,
  onLiveControl,
  guidanceMessages = []
}) => {
  const [timeLeft, setTimeLeft] = useState(controlledTimeLeft ?? durationSeconds);
  const [isActive, setIsActive] = useState(controlledIsRunning ?? false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isGuidanceExpanded, setIsGuidanceExpanded] = useState(true);
  const startedAtRef = useRef<number | null>(null);

  // Sync with controlled props from Live Mode
  // When in Live Mode, the guidance executor controls the timer state
  useEffect(() => {
    if (controlledIsRunning !== undefined) {
      setIsActive(controlledIsRunning);
      // If stopping due to guidance completion, mark as completed
      if (!controlledIsRunning && isLiveMode && timeLeft <= 0) {
        setIsCompleted(true);
      }
    }
  }, [controlledIsRunning, isLiveMode, timeLeft]);

  useEffect(() => {
    if (controlledTimeLeft !== undefined) {
      setTimeLeft(controlledTimeLeft);
      // When time reaches 0 and controlled, mark as completed
      if (controlledTimeLeft <= 0 && isLiveMode) {
        setIsCompleted(true);
        setIsActive(false);
      }
    }
  }, [controlledTimeLeft, isLiveMode]);

  // Store callback in ref to avoid triggering useEffect on every render
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  // Responsive size
  const size = 120;
  const center = size / 2;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const progress = timeLeft / durationSeconds;
  const dashoffset = circumference - progress * circumference;

  // Report state changes to parent (only when actual timer state changes)
  useEffect(() => {
    if (onStateChangeRef.current) {
      onStateChangeRef.current({
        label,
        totalSeconds: durationSeconds,
        remainingSeconds: timeLeft,
        isRunning: isActive
      });
    }
  }, [isActive, timeLeft, label, durationSeconds]); // Removed onStateChange from deps

  useEffect(() => {
    let interval: any = null;
    if (isActive && timeLeft > 0) {
      if (!startedAtRef.current) startedAtRef.current = Date.now();
      interval = setInterval(() => {
        setTimeLeft(time => {
          if (time <= 1) {
            setIsCompleted(true);
            setIsActive(false);
            return 0;
          }
          return time - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft]);

  const toggle = () => {
    if (isCompleted) {
      reset();
    } else {
      setIsActive(!isActive);
      // Notify Live Mode of control action
      if (onLiveControl) {
        onLiveControl(isActive ? 'pause' : 'resume');
      }
    }
  };

  const reset = () => {
    setIsActive(false);
    setIsCompleted(false);
    setTimeLeft(durationSeconds);
    startedAtRef.current = null;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Simple Live Mode indicator (mute button is in main VoiceControls)
  const LiveModeIndicator: React.FC<{ aiState?: string }> = ({ aiState }) => {
    const isActive = aiState === 'listening' || aiState === 'speaking';

    return (
      <div className="absolute top-2 right-2 z-10">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${isActive
          ? 'bg-orange-100 border-2 border-orange-400 shadow-lg shadow-orange-400/50'
          : 'bg-sand-100 border-2 border-sand-300'
          }`}>
          <Mic className={`w-4 h-4 transition-colors ${isActive ? 'text-orange-600' : 'text-sand-500'
            }`} />
        </div>
        {isActive && (
          <div className="absolute inset-0 rounded-full bg-orange-400/20 animate-ping pointer-events-none"></div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white/90 backdrop-blur-sm p-4 sm:p-6 rounded-3xl sm:rounded-4xl shadow-soft-lg flex flex-col gap-4 sm:gap-6 w-full max-w-md mx-auto animate-slide-up-fade border border-sand-200 relative overflow-hidden">

      {/* Live Mode Indicator - Shows when timer is active and Live Mode is on */}
      {isLiveMode && isActive && !isCompleted && (
        <LiveModeIndicator aiState={aiState} />
      )}

      {/* Timer Section */}
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
        {isActive && (
          <div className="absolute top-1/2 left-1/2 sm:left-24 w-32 sm:w-40 h-32 sm:h-40 bg-gradient-radial from-claude-200/30 to-transparent rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2 animate-breathe pointer-events-none"></div>
        )}

        {isCompleted && (
          <div className="absolute top-1/2 left-1/2 sm:left-24 w-32 sm:w-40 h-32 sm:h-40 bg-gradient-radial from-emerald-200/40 to-transparent rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2 animate-glow-pulse pointer-events-none"></div>
        )}

        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
          <svg className="w-full h-full transform -rotate-90">
            <circle stroke="#F3EDE7" strokeWidth={strokeWidth} fill="transparent" r={radius} cx={center} cy={center} />
            <circle
              stroke={isCompleted ? "url(#gradientCompleteClaude)" : "url(#gradientProgressClaude)"}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference + ' ' + circumference}
              style={{ strokeDashoffset: dashoffset }}
              strokeLinecap="round"
              fill="transparent"
              r={radius}
              cx={center}
              cy={center}
              className={`transition-all duration-1000 ease-linear ${isActive ? 'drop-shadow-md' : ''}`}
            />
            <defs>
              <linearGradient id="gradientProgressClaude" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#E87A38" />
                <stop offset="100%" stopColor="#D96922" />
              </linearGradient>
              <linearGradient id="gradientCompleteClaude" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4ADE80" />
                <stop offset="100%" stopColor="#22C55E" />
              </linearGradient>
            </defs>
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isCompleted ? (
              <CheckCircle2 className="w-10 h-10 sm:w-12 sm:h-12 text-green-500 animate-in zoom-in" />
            ) : (
              <>
                <span className="font-display text-2xl sm:text-3xl font-bold text-ink-800 tabular-nums tracking-tight">
                  {formatTime(timeLeft)}
                </span>
                <span className="text-[8px] sm:text-[9px] text-ink-400 font-display font-bold uppercase tracking-widest mt-1">
                  Remaining
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center sm:items-start space-y-3 sm:space-y-5 flex-1 min-w-0 z-10">
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
            <div className="flex items-center gap-2 mb-1">
              <TimerIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-claude-500" />
              <h4 className="font-display font-bold text-ink-800 text-base sm:text-lg">
                {isCompleted ? "Complete!" : label}
              </h4>
            </div>
            <p className="text-xs sm:text-sm text-ink-400 font-body">
              {isActive ? "Stay focused!" : isCompleted ? "Excellent work!" : "Ready when you are"}
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!isCompleted ? (
              <Button
                variant="primary"
                size="icon"
                className={`h-11 w-11 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl transition-all duration-300 ${isActive ? 'shadow-glow-claude' : ''}`}
                onClick={toggle}
              >
                {isActive ? <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-white" /> : <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-white ml-0.5" />}
              </Button>
            ) : (
              <Button
                className="h-11 sm:h-14 px-6 sm:px-8 rounded-xl sm:rounded-2xl bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-white shadow-lg shadow-green-500/20 text-sm sm:text-base"
                onClick={reset}
              >
                Done
              </Button>
            )}

            {!isCompleted && (
              <Button
                variant="secondary"
                size="icon"
                onClick={reset}
                className="h-11 w-11 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl"
              >
                <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Live Guidance Section */}
      {(currentGuidanceText || guidanceMessages.length > 0) && (
        <div className="border-t border-sand-200 mt-2 pt-4">
          {/* Active Guidance Pill */}
          {currentGuidanceText && (
            <div className="mb-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="bg-gradient-to-r from-claude-50/90 to-sand-50/90 backdrop-blur-sm border border-claude-200/60 rounded-xl p-3 shadow-sm flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-5 h-5 rounded-full bg-claude-100 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-claude-300/20 to-transparent animate-pulse-slow"></div>
                    <Sparkles className="w-3 h-3 text-claude-600 relative z-10" />
                  </div>
                </div>
                <p className="text-sm text-ink-800 font-medium leading-relaxed">
                  {currentGuidanceText}
                </p>
              </div>
            </div>
          )}

          {/* History Toggle */}
          {guidanceMessages.length > 0 && (
            <div>
              <button
                onClick={() => setIsGuidanceExpanded(!isGuidanceExpanded)}
                className="w-full group flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-sand-50 transition-all duration-200"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-ink-500 group-hover:text-claude-700 transition-colors">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Session Guidance</span>
                  <span className="bg-sand-100 text-ink-400 px-1.5 py-0.5 rounded-full text-[10px] group-hover:bg-claude-100 group-hover:text-claude-600 transition-colors">
                    {guidanceMessages.length}
                  </span>
                </div>
                {isGuidanceExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-ink-400 group-hover:text-claude-600" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-ink-400 group-hover:text-claude-600" />
                )}
              </button>

              {isGuidanceExpanded && (
                <div className="mt-2 space-y-2 animate-in slide-in-from-top-1 duration-200">
                  {guidanceMessages.slice(-3).reverse().map(msg => (
                    <div
                      key={msg.id}
                      className="ml-2 pl-3 border-l-2 border-sand-200 py-1"
                    >
                      <p className="text-xs text-ink-600 leading-relaxed font-medium">
                        {msg.text}
                      </p>
                      <span className="text-[10px] text-ink-300 mt-0.5 block font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};