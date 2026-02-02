import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, Dumbbell, Clock, Save, BookmarkCheck, Play, Pause, SkipForward, RotateCcw, Activity, Volume2, Mic, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { ExerciseGuide } from './ExerciseGuide';


interface Exercise {
    name: string;
    reps?: string;
    duration?: string;
    instructions?: string;
    restAfter?: number; // Rest period in seconds after this exercise
}
interface WorkoutListProps {
    title: string;
    exercises: Exercise[];
    workoutId?: string;
    userId?: string;
    onComplete?: (data: { workoutType: string; durationSeconds: number; exercises: Exercise[]; goalType?: string; goalIds?: string[] }) => void;
    onProgressChange?: (progress: { title: string; completedExercises: string[]; totalExercises: number }) => void;

    rounds?: number;
    // Goal metadata (for LifeContext integration)
    goalType?: string;
    goalIds?: string[];

    // Live Mode Integration
    controlledActiveIndex?: number;
    controlledCompleted?: number[];
    controlledTimerRunning?: boolean;  // When in Live Mode, timer waits for guidance to control it
    controlledIsResting?: boolean;     // True during rest periods between exercises
    controlledRestDuration?: number;   // Rest period duration in seconds
    controlledTimerDuration?: number;  // Overrides calculated duration when provided
    isLiveMode?: boolean;
    audioDataRef?: React.MutableRefObject<Float32Array>;
    aiState?: 'listening' | 'speaking' | 'processing' | 'idle';
    currentGuidanceText?: string;
    onLiveControl?: (action: 'pause' | 'resume' | 'skip' | 'back') => void;

    // Guidance Messages
    guidanceMessages?: Array<{ id: string; text: string; timestamp: number }>;
}

const parseDuration = (dur?: string): number => {
    if (!dur) return 0;
    const lower = dur.toLowerCase();
    if (lower.includes('min')) return parseInt(lower) * 60;
    if (lower.includes('s')) return parseInt(lower);
    return 0;
};

// Enhanced function to extract duration from exercise name or duration field
const extractDurationInfo = (exercise: Exercise): { duration: number; cleanName: string; displayDuration: string | null; type: 'timer' | 'reps' | 'manual' } => {
    // First check if there's a separate duration field
    if (exercise.duration) {
        const duration = parseDuration(exercise.duration);
        if (duration > 0) {
            return {
                duration,
                cleanName: exercise.name,
                displayDuration: exercise.duration,
                type: 'timer'
            };
        }
    }

    // Try to extract duration from the exercise name
    const name = exercise.name;
    const timePatterns = [
        /(\d+)\s*(?:seconds?|secs?|s)\b/i,
        /(\d+)\s*(?:minutes?|mins?|m)\b/i,
        /(\d+):(\d+)/  // mm:ss format
    ];

    for (const pattern of timePatterns) {
        const match = name.match(pattern);
        if (match) {
            let duration = 0;
            let displayDuration = '';

            if (match[2] !== undefined) {
                // mm:ss format (match[2] is the seconds part)
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                duration = minutes * 60 + seconds;
                displayDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else if (pattern.source.includes('minutes')) {
                duration = parseInt(match[1]) * 60;
                displayDuration = `${match[1]} min`;
            } else {
                duration = parseInt(match[1]);
                displayDuration = `${match[1]} seconds`;
            }

            // Clean the name by removing the time part
            const cleanName = name.replace(pattern, '').trim().replace(/\s+/g, ' ');

            return {
                duration,
                cleanName,
                displayDuration,
                type: 'timer'
            };
        }
    }

    // Check for rep-based exercises and estimate duration
    // Estimate ~2.5 seconds per rep for a natural pace
    if (exercise.reps) {
        const repMatch = exercise.reps.match(/(\d+)/);
        if (repMatch) {
            const repCount = parseInt(repMatch[1]);
            const estimatedDuration = Math.ceil(repCount * 2.5);
            return {
                duration: estimatedDuration,
                cleanName: exercise.name,
                displayDuration: null, // Don't misuse duration field for reps
                type: 'reps'
            };
        }
    }

    // Fallback: Check for "reps" or "x" in name if no explicit reps field
    const repPattern = /(\d+)\s*(?:reps?|x)\b/i;
    const repMatch = name.match(repPattern);
    if (repMatch) {
        const repCount = parseInt(repMatch[1]);
        const estimatedDuration = Math.ceil(repCount * 2.5);
        const cleanName = name.replace(repPattern, '').trim().replace(/\s+/g, ' ');
        return {
            duration: estimatedDuration,
            cleanName,
            displayDuration: null, // Don't misuse duration field for reps
            type: 'reps'
        };
    }

    return {
        duration: 0,
        cleanName: exercise.name,
        displayDuration: null,
        type: 'manual'
    };
};

import { getWorkoutProgress, setWorkoutProgress } from '../../services/storageService';
import { syncWorkoutProgressFromCloud, syncWorkoutProgressToCloud } from '../../services/persistenceService';
import { supabase, isSupabaseConfigured } from '../../supabaseConfig';

import { useAppContext } from '../../contexts/AppContext';

// Helper to get saved state (checks Supabase first for cross-device sync, then localStorage)
const getLocalState = async (
    workoutId: string | undefined,
    userId: string | undefined
): Promise<{ completed: number[]; activeIdx: number; activeTimerState?: { timeLeft: number; timestamp: number; isRunning: boolean } }> => {
    if (!workoutId) return { completed: [], activeIdx: 0 };

    try {
        // Try Supabase first for cross-device sync
        if (userId) {
            // const { syncWorkoutProgressFromCloud } = await import('../../services/persistenceService'); // Using static import
            const cloudProgress = await syncWorkoutProgressFromCloud(userId, workoutId);
            if (cloudProgress) {
                // Merge with localStorage timer state if available
                const localSaved = getWorkoutProgress(workoutId);
                return {
                    completed: cloudProgress.completed || [],
                    activeIdx: cloudProgress.activeIdx ?? 0,
                    activeTimerState: localSaved?.activeTimerState
                };
            }
        }

        // Fall back to localStorage
        const saved = getWorkoutProgress(workoutId);
        if (saved) {
            return {
                completed: saved.completed || [],
                activeIdx: saved.activeIdx ?? 0,
                activeTimerState: saved.activeTimerState
            };
        }
    } catch (e) {
        console.error("Failed to load workout state", e);
        // Fall back to localStorage on error
        try {
            const saved = getWorkoutProgress(workoutId);
            if (saved) {
                return {
                    completed: saved.completed || [],
                    activeIdx: saved.activeIdx ?? 0,
                    activeTimerState: saved.activeTimerState
                };
            }
        } catch (e2) {
            console.error("Failed to load from localStorage fallback", e2);
        }
    }
    return { completed: [], activeIdx: 0 };
};

// Simple Live Mode indicator (mute button is in main VoiceControls)
const LiveModeIndicator: React.FC<{ aiState?: string }> = ({ aiState }) => {
    const isActive = aiState === 'listening' || aiState === 'speaking';

    return (
        <div className="relative">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${isActive
                ? 'bg-orange-100 border-2 border-orange-400 shadow-md'
                : 'bg-sand-100 border-2 border-sand-300'
                }`}>
                <Mic className={`w-3.5 h-3.5 transition-colors ${isActive ? 'text-orange-600' : 'text-sand-500'
                    }`} />
            </div>
            {isActive && (
                <>
                    <div className="absolute inset-0 rounded-full bg-orange-400/30 animate-ping"></div>
                    <div className="absolute inset-0 rounded-full bg-orange-400/20 animate-pulse"></div>
                </>
            )}
        </div>
    );
};

export const WorkoutList: React.FC<WorkoutListProps> = ({
    title = "Workout",
    exercises,
    rounds = 1,
    workoutId,
    userId,
    onComplete,
    onProgressChange,
    goalType,
    goalIds,
    controlledActiveIndex,
    controlledCompleted,
    controlledTimerRunning,
    controlledIsResting,
    controlledRestDuration,
    controlledTimerDuration,
    isLiveMode = false,
    audioDataRef,
    aiState = 'idle',
    currentGuidanceText,
    onLiveControl,
    guidanceMessages = []
}) => {
    // Access global robust state
    const { workoutProgress } = useAppContext();

    // Flatten exercises based on rounds
    // If rounds > 1, repeat the exercise list n times
    const validExercises = React.useMemo(() => {
        if (!Array.isArray(exercises) || exercises.length === 0) return [];
        if (rounds <= 1) return exercises;

        const flattened: Exercise[] = [];
        // Loop for each round
        for (let r = 0; r < rounds; r++) {
            // Add exercises for this round
            exercises.forEach(ex => {
                flattened.push({ ...ex }); // Clone to avoid ref issues
            });
            // Optional: Add a "Round Break" rest item between rounds if not last round?
            // For now, let's keep it simple. The schema allows 'restAfter' on items.
        }
        return flattened;
    }, [exercises, rounds]);

    if (validExercises.length === 0) {
        return (
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-soft-lg w-full max-w-sm p-6 text-center border border-sand-200 animate-slide-up-fade">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-claude-50 flex items-center justify-center border border-claude-200">
                    <Dumbbell className="w-6 h-6 text-claude-500" />
                </div>
                <h3 className="font-display font-bold text-ink-800 text-base mb-1">No exercises found</h3>
                <p className="text-xs text-ink-400 font-body">Ask Zen to generate a workout for you!</p>
            </div>
        );
    }

    // Load state from localStorage (synchronous fallback)
    const localStateSync = workoutId ? (() => {
        try {
            const saved = getWorkoutProgress(workoutId);
            if (saved) {
                return {
                    completed: saved.completed || [],
                    activeIdx: saved.activeIdx ?? 0,
                    activeTimerState: saved.activeTimerState
                };
            }
        } catch (e) {
            console.error("Failed to load workout state", e);
        }
        return { completed: [], activeIdx: 0 };
    })() : { completed: [], activeIdx: 0 };

    // IMPORTANT: In Live Mode, controlled props take precedence over local state
    // This ensures Live Mode is the single source of truth
    const [completed, setCompleted] = useState<number[]>(() => {
        // If in Live Mode with controlled props, use them
        if (isLiveMode && controlledCompleted !== undefined) return controlledCompleted;
        // Otherwise fall back to local state
        return localStateSync.completed;
    });
    const [activeIdx, setActiveIdx] = useState(() => {
        // If in Live Mode with controlled props, use them
        if (isLiveMode && controlledActiveIndex !== undefined) return controlledActiveIndex;
        // Otherwise fall back to local state
        return localStateSync.activeIdx;
    });

    // Load from Supabase on mount for cross-device sync (async)
    useEffect(() => {
        if (!workoutId || !userId || isLiveMode) return; // Skip if Live Mode (controlled by props)

        getLocalState(workoutId, userId).then(cloudState => {
            // Use cloud state as source of truth - it reflects the latest across all devices
            // Check if cloud state differs from current (handles both additions and deletions)
            const completedChanged = JSON.stringify(cloudState.completed.sort()) !== JSON.stringify(completed.sort());
            const activeIdxChanged = cloudState.activeIdx !== activeIdx;
            
            if (completedChanged || activeIdxChanged) {
                setCompleted(cloudState.completed);
                setActiveIdx(cloudState.activeIdx);
                if (cloudState.activeTimerState) {
                    setTimeLeft(cloudState.activeTimerState.timeLeft);
                    setIsTimerRunning(cloudState.activeTimerState.isRunning);
                }
            }
        }).catch(e => {
            console.warn('Failed to load workout state from cloud:', e);
        });
    }, [workoutId, userId]); // Only run on mount or when workoutId/userId changes

    // Real-time subscription for cross-device workout progress sync
    useEffect(() => {
        if (!workoutId || !userId || isLiveMode) return;
        if (!isSupabaseConfigured) return;

        const channel = supabase
            .channel(`workout_progress:${userId}:${workoutId}`)
            .on('postgres_changes', {
                event: '*', // Listen to INSERT, UPDATE, DELETE
                schema: 'public',
                table: 'workout_progress',
                filter: `user_id=eq.${userId} AND workout_id=eq.${workoutId}`
            }, async (payload: any) => {
                if (payload.eventType === 'DELETE') {
                    // Workout progress was deleted - reset to empty state
                    setCompleted([]);
                    setActiveIdx(0);
                } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    // Workout progress was updated - sync the new state
                    const newData = payload.new;
                    const cloudCompleted = newData.completed_indices || [];
                    const cloudActiveIdx = newData.active_idx ?? 0;
                    
                    // Always update from cloud (it's the source of truth)
                    // Use functional updates to avoid stale closure issues
                    setCompleted(prev => {
                        const prevSorted = [...prev].sort();
                        const cloudSorted = [...cloudCompleted].sort();
                        if (JSON.stringify(prevSorted) !== JSON.stringify(cloudSorted)) {
                            return cloudCompleted;
                        }
                        return prev;
                    });
                    setActiveIdx(prev => prev !== cloudActiveIdx ? cloudActiveIdx : prev);
                }
            })
            .subscribe((status, err) => {
                if (err) {
                    console.error('Workout progress realtime subscription error:', err);
                }
            });

        return () => {
            supabase.removeChannel(channel).catch(console.error);
        };
    }, [workoutId, userId, isLiveMode]);
    const [isGuidanceExpanded, setIsGuidanceExpanded] = useState(true);

    // Rest period tracking
    const [isResting, setIsResting] = useState(false);

    // Sync controlled props changes from Live Mode
    // Live Mode takes precedence - it's the single source of truth
    useEffect(() => {
        if (isLiveMode && controlledCompleted !== undefined) {
            setCompleted(controlledCompleted);
        }
    }, [controlledCompleted, isLiveMode]);

    useEffect(() => {
        if (isLiveMode && controlledActiveIndex !== undefined) {
            setActiveIdx(controlledActiveIndex);
        }
    }, [controlledActiveIndex, isLiveMode]);

    // Sync rest state from Live Mode
    useEffect(() => {
        if (isLiveMode && controlledIsResting !== undefined) {
            setIsResting(controlledIsResting);
            // When rest starts, set timer to rest duration
            if (controlledIsResting && controlledRestDuration) {
                setTimeLeft(controlledRestDuration);
                setTotalTime(controlledRestDuration);
            }
        }
    }, [controlledIsResting, controlledRestDuration, isLiveMode]);

    // Timer Logic - Initialize with first exercise duration if available
    const [timeLeft, setTimeLeft] = useState(() => {
        // First try to restore from local state
        if (localStateSync.activeTimerState) {
            const { timeLeft: savedTime, timestamp, isRunning } = localStateSync.activeTimerState;
            if (isRunning) {
                const elapsed = (Date.now() - timestamp) / 1000;
                return Math.max(0, Math.floor(savedTime - elapsed));
            }
            return savedTime;
        }
        // Otherwise, initialize with first exercise's duration
        const firstExercise = validExercises[0];
        if (firstExercise) {
            const { duration } = extractDurationInfo(firstExercise);
            if (duration > 0) return duration;
        }
        return -1; // Use -1 to indicate "not initialized" - prevents auto-complete
    });

    const [totalTime, setTotalTime] = useState(() => {
        // Initialize with first exercise's duration
        const firstExercise = validExercises[0];
        if (firstExercise) {
            const { duration } = extractDurationInfo(firstExercise);
            if (duration > 0) return duration;
        }
        return 0;
    });

    const [isTimerRunning, setIsTimerRunning] = useState(() => {
        if (localStateSync.activeTimerState?.isRunning) {
            const elapsed = (Date.now() - localStateSync.activeTimerState.timestamp) / 1000;
            return localStateSync.activeTimerState.timeLeft - elapsed > 0;
        }
        return false;
    });

    const [isSaved, setIsSaved] = useState(false);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const hasCalledOnComplete = useRef(false);
    const onProgressChangeRef = useRef(onProgressChange);
    const onCompleteRef = useRef(onComplete);

    useEffect(() => { onProgressChangeRef.current = onProgressChange; }, [onProgressChange]);
    useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

    // Save state effect (localStorage + Supabase for cross-device sync)
    useEffect(() => {
        if (!workoutId) return;

        // Save to localStorage (immediate, always works)
        setWorkoutProgress(workoutId, {
            completed,
            activeIdx,
            activeTimerState: { timeLeft, timestamp: Date.now(), isRunning: isTimerRunning }
        });

        // Sync to Supabase for cross-device persistence (if userId provided)
        if (userId && workoutId) {
            // import('../../services/persistenceService').then(({ syncWorkoutProgressToCloud }) => { // Using static import
            syncWorkoutProgressToCloud(userId, workoutId, completed, activeIdx)
                .catch(e => console.warn('Failed to sync workout progress to cloud:', e));
            // });
        }

        if (onProgressChangeRef.current) {
            const completedNames = completed.map(i => validExercises[i]?.name).filter(Boolean) as string[];
            onProgressChangeRef.current({ title, completedExercises: completedNames, totalExercises: validExercises.length });
        }
    }, [completed, activeIdx, workoutId, timeLeft, isTimerRunning, title, validExercises, userId]);

    // Sync with controlled timer running state from Live Mode
    useEffect(() => {
        if (controlledTimerRunning !== undefined) {
            setIsTimerRunning(controlledTimerRunning);
        }
    }, [controlledTimerRunning]);

    // Exercise Switch Logic
    const lastActiveIdx = useRef(activeIdx);
    const hasInitializedRef = useRef(false);

    useEffect(() => {
        const currentEx = exercises[activeIdx];
        const currentDurationInfo = currentEx ? extractDurationInfo(currentEx) : { duration: 0 };
        const dur = currentDurationInfo.duration;

        if (dur > 0 && !completed.includes(activeIdx)) {
            setTotalTime(dur);

            // Check if this is a new exercise or first initialization
            const isNewExercise = activeIdx !== lastActiveIdx.current;
            const isFirstInit = !hasInitializedRef.current;

            if (isNewExercise || isFirstInit) {
                setTimeLeft(dur);
                hasInitializedRef.current = true;
                lastActiveIdx.current = activeIdx;

                // In Live Mode, don't auto-start timer - wait for guidance to control it
                // Timer only auto-starts in non-Live Mode
                if (!isLiveMode) {
                    setIsTimerRunning(true);
                } else {
                    // In Live Mode, keep timer paused until guidance starts it
                    setIsTimerRunning(false);
                }
            } else if (timeLeft <= 0 && !isTimerRunning && !isLiveMode) {
                // Only auto-restart in non-Live Mode when timer hits 0
                setTimeLeft(dur);
                setIsTimerRunning(true);
            }
        } else if (dur === 0 && !completed.includes(activeIdx)) {
            // Exercise without explicit duration - don't show timer
            // But don't reset to 0 in case it's being controlled by guidance
            if (!isLiveMode) {
                setTotalTime(0);
                setTimeLeft(0);
                setIsTimerRunning(false);
            }
        }

        if (scrollContainerRef.current) {
            const activeEl = scrollContainerRef.current.children[activeIdx] as HTMLElement;
            if (activeEl) {
                setTimeout(() => {
                    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
        }
    }, [activeIdx, exercises, isLiveMode]);

    // Timer Countdown & Synchronization
    useEffect(() => {
        let interval: any;

        const updateTimer = () => {
            if (isLiveMode && workoutProgress?.isTimerRunning && workoutProgress?.timerStartTime) {
                // Robust Sync: Calculate remaining time from fixed timestamp
                const duration = workoutProgress.timerDuration || totalTime;
                const elapsed = (Date.now() - workoutProgress.timerStartTime) / 1000;
                const remaining = Math.max(0, Math.ceil(duration - elapsed));
                setTimeLeft(remaining);
            }
        };

        if (isTimerRunning) {
            if (isLiveMode) {
                // In Live Mode, follow the shared workout timer; do not run an independent countdown.
                interval = setInterval(updateTimer, 250);
            } else {
                // Non-Live mode: simple local countdown with auto-complete.
                interval = setInterval(() => {
                    setTimeLeft(prev => {
                        if (prev <= 1) {
                            setIsTimerRunning(false);
                            if (totalTime > 0) {
                                markComplete(activeIdx);
                            }
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
            }
        }

        return () => clearInterval(interval);
    }, [isTimerRunning, timeLeft, totalTime, activeIdx, isLiveMode, workoutProgress]);

    const markComplete = useCallback((idx: number) => {
        setCompleted(prev => {
            if (prev.includes(idx)) return prev;
            const newCompleted = [...prev, idx];
            if (newCompleted.length === exercises.length && !hasCalledOnComplete.current) {
                hasCalledOnComplete.current = true;
                const totalSeconds = exercises.reduce((acc, ex) => {
                    const durationInfo = extractDurationInfo(ex);
                    return acc + durationInfo.duration;
                }, 0);
                setTimeout(() => onCompleteRef.current?.({
                    workoutType: title,
                    durationSeconds: totalSeconds,
                    exercises,
                    goalType,
                    goalIds
                }), 0);
            }
            return newCompleted;
        });
        if (idx < exercises.length - 1) setTimeout(() => setActiveIdx(idx + 1), 500);
    }, [exercises, title]);

    // Control Handlers
    const handlePauseResume = () => {
        if (isLiveMode && onLiveControl) {
            onLiveControl(isTimerRunning ? 'pause' : 'resume');
        }
        if (!isLiveMode) {
            setIsTimerRunning(!isTimerRunning);
        }
    };

    const handleSkip = () => {
        if (isLiveMode && onLiveControl) {
            onLiveControl('skip');
        }
        if (!isLiveMode) {
            markComplete(activeIdx);
        }
    };

    const formatTime = (s: number) => {
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const radius = 20;
    const circumference = 2 * Math.PI * radius;
    const dashoffset = totalTime > 0 ? circumference - (timeLeft / totalTime) * circumference : 0;
    const allCompleted = exercises.length > 0 && completed.length === exercises.length;
    const progressPercent = Math.round((completed.length / exercises.length) * 100);

    return (
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-soft-lg w-full max-w-sm animate-slide-up-fade overflow-hidden border border-sand-200 flex flex-col transition-all duration-300 max-h-[85vh] sm:max-h-[700px]">
            {/* Header - Fixed alignment for save icon */}
            <div className={`p-4 border-b border-sand-200/80 backdrop-blur-sm flex-shrink-0 transition-all duration-500 ${allCompleted
                ? 'bg-gradient-to-br from-green-50/80 to-emerald-50/50 border-green-200/50'
                : 'bg-white/95'
                }`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border transition-all duration-500 ${allCompleted
                            ? 'bg-green-100 border-green-300 text-green-700'
                            : isLiveMode
                                ? 'bg-orange-50 border-orange-200 text-orange-600'
                                : 'bg-claude-50 border-claude-200 text-claude-600'
                            }`}>
                            {allCompleted ? (
                                <Check className="w-5 h-5" />
                            ) : isLiveMode ? (
                                <Activity className="w-5 h-5" />
                            ) : (
                                <Dumbbell className="w-5 h-5" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                            <h3 className={`font-display font-bold text-base sm:text-lg leading-tight break-words transition-colors duration-500 ${allCompleted ? 'text-green-800' : 'text-ink-900'
                                }`}>
                                {title}
                            </h3>
                            {allCompleted ? (
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-sm font-display font-bold text-green-700">Workout Complete!</span>
                                    <span className="text-xs text-green-600 font-body">
                                        {completed.length} of {exercises.length} exercises
                                    </span>
                                </div>
                            ) : (
                                <p className="text-xs text-ink-500 font-body mt-0.5">
                                    {completed.length} of {exercises.length} completed
                                </p>
                            )}
                        </div>
                    </div>
                    {/* Save icon - always aligned to top-right, even with long titles */}
                    <Button
                        size="icon"
                        variant="ghost"
                        className="w-9 h-9 rounded-lg bg-sand-50 hover:bg-sand-100 border border-sand-200 flex-shrink-0 mt-0.5"
                        onClick={(e) => { e.stopPropagation(); setIsSaved(true); }}
                        disabled={isSaved}
                        aria-label={isSaved ? "Workout saved" : "Save workout"}
                    >
                        {isSaved ? (
                            <BookmarkCheck className="w-4 h-4 text-green-600" />
                        ) : (
                            <Save className="w-4 h-4 text-ink-400" />
                        )}
                    </Button>
                </div>

                {/* Progress Bar - Shows completion when done */}
                <div className="relative h-2 w-full bg-sand-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 ease-out rounded-full ${allCompleted
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                            : isLiveMode
                                ? 'bg-gradient-to-r from-orange-400 to-orange-500'
                                : 'bg-gradient-to-r from-claude-500 to-claude-400'
                            }`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Rest Period Banner - Shows during rest periods in Live Mode */}
            {isResting && isLiveMode && (
                <div className="mx-3 mb-2 p-3 rounded-xl bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 animate-pulse-subtle">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                                <RotateCcw className="w-4 h-4 text-teal-600 animate-spin" style={{ animationDuration: '3s' }} />
                            </div>
                            <div>
                                <span className="text-sm font-semibold text-teal-700">Rest Period</span>
                                <p className="text-xs text-teal-600">Catch your breath, prepare for next exercise</p>
                            </div>
                        </div>
                        <div className="text-xl font-bold text-teal-700 tabular-nums">
                            {formatTime(timeLeft)}
                        </div>
                    </div>
                </div>
            )}

            {/* Exercise List - Smart sizing and scrolling */}
            <div
                ref={scrollContainerRef}
                className={`overflow-y-auto flex-1 p-3 space-y-2 no-scrollbar scroll-smooth ${validExercises.length <= 3 ? 'pb-3' : 'pb-4'
                    }`}
                style={{
                    minHeight: 0,
                    maxHeight: 'calc(85dvh - 180px)', // Account for header height
                    scrollBehavior: 'smooth'
                }}
            >
                {exercises.map((ex, idx) => {
                    const isDone = completed.includes(idx);
                    const isActive = idx === activeIdx && !isDone;
                    const isRest = ex.name.toLowerCase().includes('rest');
                    const durationInfo = extractDurationInfo(ex);
                    const hasTimer = durationInfo.duration > 0 && durationInfo.type === 'timer';

                    return (
                        <div
                            key={idx}
                            onClick={() => !isActive && !isLiveMode && setActiveIdx(idx)}
                            className={`relative rounded-xl transition-all duration-300 border cursor-pointer overflow-hidden ${isActive
                                ? (isRest
                                    ? 'bg-teal-50/80 border-teal-300 shadow-md py-3.5 px-4'
                                    : 'bg-orange-50/80 border-orange-300 shadow-md py-3.5 px-4'
                                )
                                : isDone
                                    ? 'bg-sand-50/50 border-sand-200/50 opacity-60 py-3 px-3.5'
                                    : 'bg-white border-sand-200 py-3 px-3.5 hover:border-claude-200'
                                }`}
                        >
                            {/* Live Mode Mic Icon - Top Right Corner (only for active, non-completed exercises) */}
                            {isLiveMode && isActive && !isDone && (
                                <div className="absolute top-3 right-3 z-10">
                                    <LiveModeIndicator aiState={aiState} />
                                </div>
                            )}

                            {isActive ? (
                                // Active Card - Symmetrical layout
                                <div className="flex items-start gap-4 pr-10">
                                    {/* Exercise Number - Left aligned */}
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 flex-shrink-0 mt-0.5 ${isRest
                                        ? 'border-teal-500 text-teal-700 bg-white'
                                        : 'border-orange-500 text-orange-700 bg-white'
                                        }`}>
                                        <span className="text-sm font-display font-bold">{idx + 1}</span>
                                    </div>

                                    {/* Exercise Content - Center aligned */}
                                    <div className="flex-1 min-w-0">
                                        {/* Title - Clean name without duration */}
                                        <h4 className="font-display font-bold text-ink-900 text-base mb-1.5 leading-tight break-words">
                                            {durationInfo.cleanName}
                                        </h4>

                                        {/* Time/Duration Info - Below title, responsive */}
                                        {/* Time/Duration Info - Below title, responsive */}
                                        {(durationInfo.displayDuration || (ex.reps && (!isActive || hasTimer)) || ex.restAfter) && (
                                            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-sm text-ink-500 mb-3">
                                                {durationInfo.displayDuration && (
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                                                        <span>{durationInfo.displayDuration}</span>
                                                    </span>
                                                )}
                                                {ex.reps && (!isActive || hasTimer) && !durationInfo.displayDuration && (
                                                    <span>{ex.reps}</span>
                                                )}
                                                {ex.reps && (!isActive || hasTimer) && durationInfo.displayDuration && (
                                                    <span>• {ex.reps}</span>
                                                )}
                                                {ex.restAfter && ex.restAfter > 0 && (
                                                    <span className="flex items-center gap-1 text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full text-xs font-medium">
                                                        <RotateCcw className="w-3 h-3" />
                                                        {ex.restAfter}s rest
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Exercise demo - active non-rest only */}
                                        {!isRest && (
                                            <ExerciseGuide
                                                key={durationInfo.cleanName}
                                                exerciseName={durationInfo.cleanName}
                                                className="mb-4 w-full max-w-[240px]"
                                            />
                                        )}

                                        {/* Timer and Controls - Horizontally aligned */}
                                        {hasTimer ? (
                                            <div className="flex items-center gap-3.5">
                                                {/* Circular Timer */}
                                                <div className="relative w-[72px] h-[72px] flex items-center justify-center flex-shrink-0">
                                                    <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 48 48">
                                                        <circle
                                                            cx="24"
                                                            cy="24"
                                                            r={radius}
                                                            className="stroke-sand-200"
                                                            strokeWidth="3"
                                                            fill="none"
                                                        />
                                                        <circle
                                                            cx="24"
                                                            cy="24"
                                                            r={radius}
                                                            className={`transition-all duration-1000 ease-linear ${isRest ? 'stroke-accent-teal' : 'stroke-orange-500'
                                                                }`}
                                                            strokeWidth="3"
                                                            fill="none"
                                                            strokeDasharray={circumference}
                                                            strokeDashoffset={dashoffset}
                                                            strokeLinecap="round"
                                                        />
                                                    </svg>
                                                    <span className="absolute text-base font-display font-bold text-ink-900 tabular-nums">
                                                        {formatTime(timeLeft)}
                                                    </span>
                                                </div>

                                                {/* Controls - Larger buttons */}
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-9 w-9 rounded-lg bg-white hover:bg-sand-50 border border-sand-200"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setIsTimerRunning(false);
                                                            setTimeLeft(totalTime);
                                                        }}
                                                        aria-label="Reset timer"
                                                    >
                                                        <RotateCcw className="w-4 h-4 text-ink-600" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant={isRest ? "teal" : "primary"}
                                                        className="h-9 w-9 rounded-lg shadow-sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handlePauseResume();
                                                        }}
                                                        aria-label={isTimerRunning ? "Pause" : "Resume"}
                                                    >
                                                        {isTimerRunning ? (
                                                            <Pause className="w-5 h-5 fill-current" />
                                                        ) : (
                                                            <Play className="w-5 h-5 fill-current ml-0.5" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant="secondary"
                                                        className="h-9 w-9 rounded-lg bg-white border border-sand-200"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSkip();
                                                        }}
                                                        aria-label="Skip exercise"
                                                    >
                                                        <SkipForward className="w-4 h-4 text-ink-600" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {/* Show sets/reps for non-timed exercises */}
                                                {durationInfo.type === 'reps' && (
                                                    <div className="text-sm text-ink-600 font-body bg-sand-50 px-3 py-2 rounded-lg border border-sand-200 shadow-sm inline-block">
                                                        <span className="font-semibold text-ink-800">Target: </span>
                                                        {durationInfo.displayDuration || ex.reps || "Complete reps"}
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-3">
                                                    <Button
                                                        className="flex-1 rounded-xl py-2.5 text-sm font-bold shadow-sm bg-gradient-to-br from-claude-500 to-claude-600 text-white hover:from-claude-600 hover:to-claude-700 transition-all active:scale-95"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSkip();
                                                        }}
                                                    >
                                                        Mark Complete
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                // Inactive Card - Compact, symmetrical
                                <div className="flex items-center gap-3">
                                    {/* Exercise Number - Always on left */}
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 flex-shrink-0 ${isDone
                                        ? 'border-sand-300 text-ink-400 bg-sand-50'
                                        : 'border-orange-400 text-orange-600 bg-transparent'
                                        }`}>
                                        <span className="text-xs font-display font-bold">{idx + 1}</span>
                                    </div>

                                    {/* Exercise Info */}
                                    <div className="flex-1 min-w-0">
                                        <span className={`font-display font-semibold text-sm sm:text-base block truncate ${isDone ? 'text-ink-400 line-through' : 'text-ink-700'
                                            }`}>
                                            {durationInfo.cleanName}
                                        </span>
                                        {/* Time info below title for better responsiveness */}
                                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-400 mt-1">
                                            {durationInfo.displayDuration && (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {durationInfo.displayDuration}
                                                </span>
                                            )}
                                            {ex.reps && <span>{ex.reps}</span>}
                                            {ex.restAfter && ex.restAfter > 0 && !isDone && (
                                                <span className="flex items-center gap-1 text-teal-500">
                                                    <RotateCcw className="w-2.5 h-2.5" />
                                                    {ex.restAfter}s rest
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right Indicator - Completion checkmark or empty circle */}
                                    {isDone ? (
                                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-green-500 border-2 border-green-600 flex-shrink-0">
                                            <Check className="w-4 h-4 text-white" />
                                        </div>
                                    ) : !isLiveMode ? (
                                        <div className="w-5 h-5 rounded-full border-2 border-orange-300 flex-shrink-0"></div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Live Guidance Section */}
            {(currentGuidanceText || guidanceMessages.length > 0) && (
                <div className="px-4 pb-4 mt-2">
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
                        <div className="border-t border-sand-200/60 pt-3">
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
