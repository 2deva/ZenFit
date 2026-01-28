
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Message, MessageRole, UIComponentData } from '../types';
import { GoalSelector } from './tools/GoalSelector';
import { Timer } from './tools/Timer';
import { ChartWidget } from './tools/ChartWidget';
import { DashboardWidget } from './tools/DashboardWidget';
import { WorkoutList } from './tools/WorkoutList';
import { MapWidget } from './tools/MapWidget';
import { WorkoutBuilder } from './tools/WorkoutBuilder';
import { StreakTimeline } from './tools/StreakTimeline';
import { HabitHeatmap } from './tools/HabitHeatmap';
import { AchievementBadge } from './tools/AchievementBadge';
import { MapPin, ArrowUpRight, Sparkles } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';

interface MessageBubbleProps {
  message: Message;
  userId?: string; // Supabase user ID for cross-device sync
  onAction?: (action: string, data: any) => void;
  // Live Mode Props
  isLiveMode?: boolean;
  audioDataRef?: React.MutableRefObject<Float32Array>;
  aiState?: 'listening' | 'speaking' | 'processing' | 'idle';
  currentGuidanceText?: string;
  onLiveControl?: (action: 'pause' | 'resume' | 'skip' | 'back') => void;
  // Guidance Messages
  guidanceMessages?: Array<{ id: string; text: string; timestamp: number }>;
  // Active timer state (for controlling timer component)
  activeTimer?: { label: string; totalSeconds: number; remainingSeconds: number; isRunning: boolean } | null;
  // Controlled workout progress (from guidance executor)
  workoutProgress?: {
    currentExerciseIndex: number;
    completedIndices: number[];
    isTimerRunning: boolean;
    isResting?: boolean;
    restDuration?: number;
    timerDuration?: number;
  } | null;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
  message,
  userId,
  onAction,
  isLiveMode,
  audioDataRef,
  aiState,
  currentGuidanceText,
  onLiveControl,
  guidanceMessages,
  activeTimer,
  workoutProgress
}) => {
  const isUser = message.role === MessageRole.USER;

  const renderUI = (component?: UIComponentData) => {
    if (!component) return null;

    return (
      <ErrorBoundary scope={component.type}>
        {(() => {
          switch (component.type) {
            case 'goalSelector':
              return <GoalSelector
                onSave={(goals) => onAction && onAction('saveGoals', goals)}
                options={component.props?.options}
                title={component.props?.selectorTitle}
                subtitle={component.props?.selectorSubtitle}
              />;
            case 'timer':
              return <Timer
                durationSeconds={component.props.duration ?? 60}
                label={component.props.label}
                goalType={component.props.goalType}
                goalIds={component.props.goalIds}
                onStateChange={(state) => onAction && onAction('timerStateChange', state)}
                onComplete={(data) => onAction && onAction('timerComplete', data)}
                // Controlled state (synced with guidance)
                controlledIsRunning={activeTimer?.isRunning}
                controlledTimeLeft={activeTimer?.remainingSeconds}
                // Live Mode Integration
                isLiveMode={isLiveMode}
                audioDataRef={audioDataRef}
                aiState={aiState}
                currentGuidanceText={currentGuidanceText}
                onLiveControl={onLiveControl}
                // Guidance Messages
                guidanceMessages={guidanceMessages}
              />;
            case 'chart':
              return <ChartWidget data={component.props.data} title={component.props.chartTitle || component.props.title} dataKey={component.props.dataKey} />;
            case 'dashboard':
              return <DashboardWidget {...component.props} />;
            case 'workoutList':
              return <WorkoutList
                {...component.props}
                workoutId={message.id}
                userId={userId}
                goalType={component.props.goalType}
                goalIds={component.props.goalIds}
                onComplete={(data) => onAction && onAction('workoutComplete', data)}
                onProgressChange={(progress) => onAction && onAction('workoutProgressChange', progress)}
                // Live Mode Integration
                isLiveMode={isLiveMode}
                audioDataRef={audioDataRef}
                aiState={aiState}
                currentGuidanceText={currentGuidanceText}
                onLiveControl={onLiveControl}
                // Guidance Messages
                guidanceMessages={guidanceMessages}
                // Controlled state from guidance executor
                controlledActiveIndex={workoutProgress?.currentExerciseIndex}
                controlledCompleted={workoutProgress?.completedIndices}
                controlledTimerRunning={workoutProgress?.isTimerRunning}
                controlledIsResting={workoutProgress?.isResting}
                controlledRestDuration={workoutProgress?.restDuration}
                controlledTimerDuration={workoutProgress?.timerDuration}
              />;
            case 'map':
              return <MapWidget {...component.props} />;
            case 'workoutBuilder':
              return <WorkoutBuilder
                {...component.props}
                onGenerate={(params) => onAction && onAction('generateWorkout', params)}
                isLiveMode={isLiveMode}
                onLiveSubmit={(params) => onAction && onAction('liveWorkoutSubmit', params)}
              />;
            case 'streakTimeline':
              return <StreakTimeline {...component.props} />;
            case 'habitHeatmap':
              return <HabitHeatmap {...component.props} />;
            case 'achievementBadge':
              return <AchievementBadge {...component.props} />;
            default:
              return null;
          }
        })()}
      </ErrorBoundary>
    );
  };

  const renderGrounding = () => {
    if (!message.groundingChunks || message.groundingChunks.length === 0) return null;
    return (
      <div className="mt-3 sm:mt-4 flex flex-wrap gap-1.5 sm:gap-2">
        {message.groundingChunks.map((chunk, idx) => {
          if (chunk.web) {
            return (
              <a
                key={idx}
                href={chunk.web.uri}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center space-x-1.5 sm:space-x-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-white/80 backdrop-blur-sm border border-sand-200 hover:border-claude-300 hover:shadow-glow-claude transition-all duration-300"
              >
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gradient-to-br from-claude-400 to-claude-600"></div>
                <span className="text-[10px] sm:text-xs font-semibold text-ink-600 max-w-[100px] sm:max-w-[150px] truncate group-hover:text-claude-700 transition-colors">{chunk.web.title}</span>
                <ArrowUpRight className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-ink-400 group-hover:text-claude-600 transition-colors" />
              </a>
            )
          }
          if (chunk.maps) {
            return (
              <a
                key={idx}
                href={chunk.maps.uri}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center space-x-1.5 sm:space-x-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-white/80 backdrop-blur-sm border border-sand-200 hover:border-accent-teal/50 transition-all duration-300"
              >
                <MapPin className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-accent-teal" />
                <span className="text-[10px] sm:text-xs font-semibold text-ink-600 max-w-[100px] sm:max-w-[150px] truncate group-hover:text-accent-teal transition-colors">{chunk.maps.title}</span>
              </a>
            )
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div className={`flex w-full mb-6 sm:mb-8 animate-slide-up-fade ${isUser ? 'justify-end' : 'justify-start'}`}>

      {/* Model Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 mr-2 sm:mr-3 mt-1">
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-claude-400 to-claude-600 rounded-lg sm:rounded-xl blur-md opacity-30 group-hover:opacity-50 transition-opacity"></div>
            <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-gradient-to-br from-claude-500 to-claude-600 flex items-center justify-center shadow-soft text-white">
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>
        </div>
      )}

      <div className={`flex flex-col max-w-[88%] sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Thinking */}
        {message.isThinking && !isUser && (
          <div className="flex items-center space-x-2 mb-2 ml-1 opacity-70">
            <div className="flex space-x-1">
              <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-claude-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-claude-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-claude-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        )}

        {/* Bubble */}
        {message.text && (
          <div className={`
                        px-4 sm:px-5 py-3 sm:py-4 text-sm sm:text-[15px] leading-relaxed font-body
                        ${isUser
              ? 'bg-gradient-to-br from-claude-500 to-claude-600 text-white rounded-2xl sm:rounded-3xl rounded-br-lg shadow-lg shadow-claude-500/15'
              : 'bg-white/90 backdrop-blur-sm text-ink-700 rounded-2xl sm:rounded-3xl rounded-bl-lg border border-sand-200 shadow-soft'}
                    `}>
            <ReactMarkdown
              components={{
                p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                strong: ({ node, ...props }) => <strong className={`font-semibold ${isUser ? 'text-white' : 'text-ink-900'}`} {...props} />,
                em: ({ node, ...props }) => <em className={`${isUser ? 'text-claude-100' : 'text-claude-600'}`} {...props} />,
              }}
            >
              {message.text}
            </ReactMarkdown>
          </div>
        )}

        {/* UI & Grounding */}
        {(message.uiComponent || message.groundingChunks) && (
          <div className="mt-3 sm:mt-4 w-full">
            {renderUI(message.uiComponent)}
            {renderGrounding()}
          </div>
        )}

        {/* Time */}
        <span className="text-[9px] sm:text-[10px] font-medium text-ink-300 mt-1.5 sm:mt-2 mx-1 select-none font-body">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
});

// Display name for debugging
MessageBubble.displayName = 'MessageBubble';
