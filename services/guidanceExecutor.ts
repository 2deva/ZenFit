/**
 * Guidance Executor Service
 * 
 * Manages real-time voice guidance execution during workouts, breathing,
 * and meditation sessions. Schedules and plays cues through the Live session.
 */

import {
    GuidanceCue,
    generateGuidanceCues,
    VoiceGuidanceConfig,
    Exercise,
    BREATHING_PATTERNS
} from './voiceGuidanceService';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type GuidanceStatus = 'idle' | 'active' | 'paused' | 'completed';

export interface GuidanceProgress {
    status: GuidanceStatus;
    activityType: string;
    currentExerciseIndex: number;
    totalExercises: number;
    currentCueIndex: number;
    totalCues: number;
    elapsedTime: number;
    remainingTime: number;
    currentExerciseName?: string;
    nextExerciseName?: string;
    isPaused: boolean;
    pausedAt?: number;
    completedExercises: string[];
}

export interface GuidanceCallbacks {
    onCue: (cue: GuidanceCue, text: string) => void;
    onExerciseStart: (exerciseName: string, index: number) => void;
    onExerciseComplete: (exerciseName: string, index: number) => void;
    onActivityComplete: () => void;
    onProgressUpdate: (progress: GuidanceProgress) => void;
    onTimerControl?: (action: 'start' | 'stop' | 'reset', exerciseIndex: number, duration?: number) => void;
    onRestPeriod?: (action: 'start' | 'end', exerciseIndex: number, duration?: number) => void;
    onError?: (error: string) => void;
}

interface ScheduledCue {
    cue: GuidanceCue;
    timerId: NodeJS.Timeout;
    scheduledFor: number;
}

// ============================================================================
// GUIDANCE EXECUTOR CLASS
// ============================================================================

export class GuidanceExecutor {
    private cues: GuidanceCue[] = [];
    private scheduledCues: ScheduledCue[] = [];
    private currentCueIndex: number = 0;
    private currentExerciseIndex: number = 0;
    private startTime: number = 0;
    private pauseTime: number = 0;
    private totalPausedDuration: number = 0;
    private status: GuidanceStatus = 'idle';
    private activityType: string = '';
    private exercises: Exercise[] = [];
    private callbacks: GuidanceCallbacks | null = null;
    private paceMultiplier: number = 1.0;
    private progressInterval: NodeJS.Timeout | null = null;
    // Short-lived 3‑2‑1‑Go countdown timers, tracked separately so they can be cancelled
    // when the user pauses, skips, goes back, or the session stops/completes.
    private countdownTimers: NodeJS.Timeout[] = [];
    
    // Adaptive pacing for rep-based exercises
    private repTimings: number[] = []; // Store timing between reps
    private lastRepTime: number = 0;   // Track when last rep was completed
    private currentRep: number = 0;    // Current rep count
    private targetReps: number = 0;    // Target reps for current exercise
    private adaptivePaceEnabled: boolean = true;
    private averageRepDuration: number = 2500; // Default 2.5 seconds, will adapt

    /**
     * Initialize guidance with a configuration
     */
    initialize(
        config: VoiceGuidanceConfig,
        callbacks: GuidanceCallbacks
    ): void {
        this.reset();
        this.callbacks = callbacks;
        this.activityType = config.activity;
        this.exercises = config.exercises || [];
        this.paceMultiplier = this.getPaceMultiplier(config.pace || 'normal');
        
        // Generate cues
        this.cues = generateGuidanceCues(config);
        
        if (this.cues.length === 0) {
            callbacks.onError?.('No guidance cues generated for this activity');
            return;
        }

        console.log(`GuidanceExecutor: Initialized with ${this.cues.length} cues for ${config.activity}`);
    }

    /**
     * Start or resume guidance execution
     */
    start(): void {
        if (this.status === 'active') return;

        if (this.status === 'paused') {
            this.resume();
            return;
        }

        if (this.cues.length === 0) {
            this.callbacks?.onError?.('No cues to execute. Initialize first.');
            return;
        }

        this.status = 'active';
        this.startTime = Date.now();
        this.currentCueIndex = 0;
        this.currentExerciseIndex = 0;
        this.totalPausedDuration = 0;

        console.log('GuidanceExecutor: Starting guidance');
        
        // IMPORTANT: Trigger onExerciseStart for the first exercise immediately
        // This ensures the UI knows we're starting at exercise 0
        if (this.exercises.length > 0) {
            this.callbacks?.onExerciseStart(this.exercises[0].name, 0);
        }
        
        // Schedule all cues
        this.scheduleCues();
        
        // Start progress updates
        this.startProgressUpdates();
        
        // Execute first cue immediately if it's at timing 0
        if (this.cues.length > 0 && this.cues[0].timing === 0) {
            this.executeCue(this.cues[0]);
        }
    }

    /**
     * Pause guidance execution
     */
    pause(): void {
        if (this.status !== 'active') return;

        this.status = 'paused';
        this.pauseTime = Date.now();
        
        // Clear all scheduled timers (including countdowns)
        this.clearScheduledCues();
        this.clearCountdownTimers();
        
        // Stop progress updates
        this.stopProgressUpdates();
        
        console.log('GuidanceExecutor: Paused');
        this.updateProgress();
    }

    /**
     * Resume guidance from pause
     */
    resume(): void {
        if (this.status !== 'paused') return;

        const pauseDuration = Date.now() - this.pauseTime;
        this.totalPausedDuration += pauseDuration;
        this.status = 'active';
        
        console.log(`GuidanceExecutor: Resumed after ${pauseDuration}ms pause`);
        
        // Recalculate timer duration for current exercise based on elapsed time
        const currentExercise = this.exercises[this.currentExerciseIndex];
        if (currentExercise) {
            const originalDuration = this.getExerciseDuration(currentExercise);
            const elapsedTime = (Date.now() - this.startTime - this.totalPausedDuration) / 1000; // in seconds
            
            // Find the start time of current exercise by looking at cues
            let exerciseStartTime = 0;
            const exerciseStartCue = this.cues.find(c => 
                c.exerciseIndex === this.currentExerciseIndex && 
                (c.type === 'transition' || c.text.toLowerCase().includes('go!'))
            );
            if (exerciseStartCue) {
                exerciseStartTime = exerciseStartCue.timing / 1000; // Convert to seconds
            }
            
            const exerciseElapsed = Math.max(0, elapsedTime - exerciseStartTime);
            const remainingTime = Math.max(0, originalDuration - exerciseElapsed);
            
            // Update timer with remaining time
            if (remainingTime > 0 && remainingTime < originalDuration) {
                this.callbacks?.onTimerControl?.('reset', this.currentExerciseIndex, Math.ceil(remainingTime));
                console.log(`GuidanceExecutor: Recalculated timer duration: ${Math.ceil(remainingTime)}s remaining (was ${originalDuration}s)`);
            } else if (remainingTime <= 0) {
                // Exercise time has elapsed, mark as complete
                this.callbacks?.onTimerControl?.('stop', this.currentExerciseIndex);
                console.log(`GuidanceExecutor: Exercise time elapsed during pause, marking complete`);
            }
        }
        
        // Reschedule remaining cues
        this.scheduleRemainingCues();
        
        // Restart progress updates
        this.startProgressUpdates();
        
        // Announce resume
        if (currentExercise) {
            this.callbacks?.onCue({
                timing: 0,
                type: 'instruction',
                text: `Resuming. ${currentExercise.name}. Let's go!`,
                priority: 'immediate'
            }, `Resuming. ${currentExercise.name}. Let's go!`);
        }
    }

    /**
     * Skip to next exercise
     */
    skip(): void {
        if (this.status !== 'active' && this.status !== 'paused') return;

        const currentExercise = this.exercises[this.currentExerciseIndex];
        if (currentExercise) {
            // Stop current timer
            this.callbacks?.onTimerControl?.('stop', this.currentExerciseIndex);
            this.callbacks?.onRestPeriod?.('end', this.currentExerciseIndex);
            this.callbacks?.onExerciseComplete(currentExercise.name, this.currentExerciseIndex);
        }

        this.currentExerciseIndex++;
        
        if (this.currentExerciseIndex >= this.exercises.length) {
            this.complete();
            return;
        }

        // Clear any pending cues and countdowns and reschedule from new exercise
        this.clearScheduledCues();
        this.clearCountdownTimers();
        
        // Find cues for next exercise
        const nextExerciseCues = this.cues.filter(c => c.exerciseIndex === this.currentExerciseIndex);
        if (nextExerciseCues.length > 0) {
            this.currentCueIndex = this.cues.indexOf(nextExerciseCues[0]);
        }
        
        // Announce skip and prepare next exercise
        const nextExercise = this.exercises[this.currentExerciseIndex];
        if (nextExercise) {
            this.callbacks?.onExerciseStart(nextExercise.name, this.currentExerciseIndex);
            const duration = this.getExerciseDuration(nextExercise);
            this.callbacks?.onTimerControl?.('reset', this.currentExerciseIndex, duration);
            // Send countdown as separate cues for clear TTS
            this.callbacks?.onCue({
                timing: 0,
                type: 'transition',
                text: `Skipping to ${nextExercise.name}. Ready?`,
                priority: 'immediate'
            }, `Skipping to ${nextExercise.name}. Ready?`);
            
            // Countdown: 3, 2, 1, Go! - each sent separately with 1 second delay
            this.clearCountdownTimers();
            this.countdownTimers.push(
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'count', text: '3', priority: 'immediate' }, '3');
                    }
                }, 1000),
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'count', text: '2', priority: 'immediate' }, '2');
                    }
                }, 2000),
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'count', text: '1', priority: 'immediate' }, '1');
                    }
                }, 3000),
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'instruction', text: 'Go!', priority: 'immediate' }, 'Go!');
                        // Start timer after countdown completes
                        this.callbacks?.onTimerControl?.('start', this.currentExerciseIndex);
                    }
                }, 4000)
            );
        }
        
        // Reschedule remaining cues if active
        if (this.status === 'active') {
            this.scheduleRemainingCues();
        }
    }

    /**
     * Go back to previous exercise
     */
    goBack(): void {
        if (this.status !== 'active' && this.status !== 'paused') return;
        
        // Can't go back from first exercise
        if (this.currentExerciseIndex <= 0) {
            this.callbacks?.onCue({
                timing: 0,
                type: 'instruction',
                text: "Already at the first exercise. Let's keep going!",
                priority: 'immediate'
            }, "Already at the first exercise. Let's keep going!");
            return;
        }

        // Stop current exercise
        const currentExercise = this.exercises[this.currentExerciseIndex];
        if (currentExercise) {
            this.callbacks?.onTimerControl?.('stop', this.currentExerciseIndex);
            this.callbacks?.onRestPeriod?.('end', this.currentExerciseIndex);
        }

        // Go back to previous exercise
        this.currentExerciseIndex--;
        
        // Clear any pending cues and countdowns and reschedule from previous exercise
        this.clearScheduledCues();
        this.clearCountdownTimers();
        
        // Find cues for previous exercise
        const prevExerciseCues = this.cues.filter(c => c.exerciseIndex === this.currentExerciseIndex);
        if (prevExerciseCues.length > 0) {
            this.currentCueIndex = this.cues.indexOf(prevExerciseCues[0]);
        }
        
        // Announce going back
        const prevExercise = this.exercises[this.currentExerciseIndex];
        if (prevExercise) {
            this.callbacks?.onExerciseStart(prevExercise.name, this.currentExerciseIndex);
            const duration = this.getExerciseDuration(prevExercise);
            this.callbacks?.onTimerControl?.('reset', this.currentExerciseIndex, duration);
            // Send countdown as separate cues for clear TTS
            this.callbacks?.onCue({
                timing: 0,
                type: 'transition',
                text: `Going back to ${prevExercise.name}. Let's do this again! Ready?`,
                priority: 'immediate'
            }, `Going back to ${prevExercise.name}. Let's do this again! Ready?`);
            
            // Countdown: 3, 2, 1, Go! - each sent separately with 1 second delay
            this.clearCountdownTimers();
            this.countdownTimers.push(
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'count', text: '3', priority: 'immediate' }, '3');
                    }
                }, 1000),
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'count', text: '2', priority: 'immediate' }, '2');
                    }
                }, 2000),
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'count', text: '1', priority: 'immediate' }, '1');
                    }
                }, 3000),
                setTimeout(() => {
                    if (this.status === 'active') {
                        this.callbacks?.onCue({ timing: 0, type: 'instruction', text: 'Go!', priority: 'immediate' }, 'Go!');
                        // Start timer after countdown completes
                        this.callbacks?.onTimerControl?.('start', this.currentExerciseIndex);
                    }
                }, 4000)
            );
        }
        
        // Reschedule remaining cues if active
        if (this.status === 'active') {
            this.scheduleRemainingCues();
        }
        
        console.log(`GuidanceExecutor: Went back to exercise ${this.currentExerciseIndex + 1}`);
    }

    /**
     * Adjust pace
     */
    adjustPace(newPace: 'slow' | 'normal' | 'fast'): void {
        const oldMultiplier = this.paceMultiplier;
        this.paceMultiplier = this.getPaceMultiplier(newPace);
        
        console.log(`GuidanceExecutor: Pace adjusted from ${oldMultiplier} to ${this.paceMultiplier}`);
        
        // Reschedule remaining cues with new pace
        if (this.status === 'active') {
            this.clearScheduledCues();
            this.scheduleRemainingCues();
        }
    }

    /**
     * Stop and complete the session
     */
    stop(): void {
        // Prevent circular call: if already completed or completing, don't call complete() again
        if (this.status === 'completed' || this.status === 'idle') {
            return;
        }
        this.complete();
    }

    // ========================================================================
    // ADAPTIVE PACING FOR REP-BASED EXERCISES
    // ========================================================================
    
    /**
     * Enable or disable adaptive pacing
     */
    setAdaptivePacing(enabled: boolean): void {
        this.adaptivePaceEnabled = enabled;
        console.log(`GuidanceExecutor: Adaptive pacing ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Confirm rep completion - used for voice-activated rep counting
     * Call this when user says "done", "next", or a number
     */
    confirmRep(repNumber?: number): void {
        if (this.status !== 'active') return;
        
        const now = Date.now();
        const currentExercise = this.exercises[this.currentExerciseIndex];
        
        if (!currentExercise?.reps) {
            // Not a rep-based exercise
            return;
        }
        
        // Calculate timing since last rep
        if (this.lastRepTime > 0) {
            const repDuration = now - this.lastRepTime;
            this.repTimings.push(repDuration);
            
            // Update average (weighted moving average for recent reps)
            if (this.repTimings.length >= 3 && this.adaptivePaceEnabled) {
                // Use last 5 reps for average, weighted toward recent
                const recentTimings = this.repTimings.slice(-5);
                const weights = recentTimings.map((_, i) => i + 1);
                const weightSum = weights.reduce((a, b) => a + b, 0);
                const weightedSum = recentTimings.reduce((sum, t, i) => sum + t * weights[i], 0);
                const newAverage = Math.round(weightedSum / weightSum);
                
                // Check if pace changed significantly (more than 20%)
                const paceChange = Math.abs(newAverage - this.averageRepDuration) / this.averageRepDuration;
                const oldAverage = this.averageRepDuration;
                this.averageRepDuration = newAverage;
                
                console.log(`GuidanceExecutor: Adapted rep timing to ${this.averageRepDuration}ms (from ${recentTimings.length} samples)`);
                
                // If pace changed significantly and we have remaining cues for current exercise, reschedule them
                if (paceChange > 0.2 && this.status === 'active') {
                    this.rescheduleCurrentExerciseCues(oldAverage, newAverage);
                }
            }
        }
        
        this.lastRepTime = now;
        this.currentRep = repNumber ?? (this.currentRep + 1);
        
        // Announce the rep
        this.callbacks?.onCue({
            timing: 0,
            type: 'count',
            text: this.currentRep.toString(),
            priority: 'immediate',
            exerciseIndex: this.currentExerciseIndex
        }, this.currentRep.toString());
        
        // Update timer duration based on actual rep pace (if we have enough data)
        if (this.repTimings.length >= 2 && this.adaptivePaceEnabled && this.targetReps > 0) {
            // Calculate estimated remaining time based on actual pace
            const remainingReps = this.targetReps - this.currentRep;
            const estimatedRemainingTime = Math.ceil((this.averageRepDuration * remainingReps) / 1000); // Convert to seconds
            
            // Update timer duration to match actual pace
            if (estimatedRemainingTime > 0) {
                this.callbacks?.onTimerControl?.('reset', this.currentExerciseIndex, estimatedRemainingTime);
                console.log(`GuidanceExecutor: Updated timer to ${estimatedRemainingTime}s based on actual rep pace`);
            }
        }
        
        // Check if exercise is complete
        if (this.currentRep >= this.targetReps) {
            this.completeCurrentExercise();
        }
    }
    
    /**
     * Set target reps for current exercise (called when exercise starts)
     */
    private initRepTracking(exercise: Exercise): void {
        this.currentRep = 0;
        this.lastRepTime = 0;
        this.repTimings = [];
        
        if (exercise.reps) {
            const repMatch = exercise.reps.match(/(\d+)/);
            this.targetReps = repMatch ? parseInt(repMatch[1]) : 10;
        } else {
            this.targetReps = 0;
        }
    }
    
    /**
     * Complete current exercise (triggered by rep completion or manual skip)
     */
    private completeCurrentExercise(): void {
        const currentExercise = this.exercises[this.currentExerciseIndex];
        if (!currentExercise) return;
        
        // Stop timer and mark complete
        this.callbacks?.onTimerControl?.('stop', this.currentExerciseIndex);
        this.callbacks?.onExerciseComplete(currentExercise.name, this.currentExerciseIndex);
        
        // Move to next exercise or complete workout
        this.currentExerciseIndex++;
        
        if (this.currentExerciseIndex >= this.exercises.length) {
            this.complete();
            return;
        }
        
        // Start rest period if applicable
        const restDuration = currentExercise.restAfter || 30;
        if (restDuration > 0) {
            this.callbacks?.onRestPeriod?.('start', this.currentExerciseIndex - 1, restDuration);
            this.callbacks?.onCue({
                timing: 0,
                type: 'rest',
                text: `Rest for ${restDuration} seconds. Great work!`,
                priority: 'immediate',
                exerciseIndex: this.currentExerciseIndex - 1
            }, `Rest for ${restDuration} seconds. Great work!`);
            
            // Schedule next exercise after rest
            setTimeout(() => {
                if (this.status === 'active') {
                    this.startNextExercise();
                }
            }, restDuration * 1000);
        } else {
            this.startNextExercise();
        }
    }
    
    /**
     * Start the next exercise
     */
    private startNextExercise(): void {
        const nextExercise = this.exercises[this.currentExerciseIndex];
        if (!nextExercise) return;
        
        // End rest period
        this.callbacks?.onRestPeriod?.('end', this.currentExerciseIndex);
        
        // Initialize rep tracking for new exercise
        this.initRepTracking(nextExercise);
        
        // Announce and start
        this.callbacks?.onExerciseStart(nextExercise.name, this.currentExerciseIndex);
        const duration = this.getExerciseDuration(nextExercise);
        this.callbacks?.onTimerControl?.('reset', this.currentExerciseIndex, duration);
        
        // Send countdown as separate cues for clear TTS
        this.callbacks?.onCue({
            timing: 0,
            type: 'transition',
            text: `Next up: ${nextExercise.name}. Ready?`,
            priority: 'immediate',
            exerciseIndex: this.currentExerciseIndex
        }, `Next up: ${nextExercise.name}. Ready?`);
        
        // Countdown: 3, 2, 1, Go! - each sent separately with 1 second delay
        this.clearCountdownTimers();
        this.countdownTimers.push(
            setTimeout(() => {
                if (this.status === 'active') {
                    this.callbacks?.onCue({ timing: 0, type: 'count', text: '3', priority: 'immediate', exerciseIndex: this.currentExerciseIndex }, '3');
                }
            }, 1000),
            setTimeout(() => {
                if (this.status === 'active') {
                    this.callbacks?.onCue({ timing: 0, type: 'count', text: '2', priority: 'immediate', exerciseIndex: this.currentExerciseIndex }, '2');
                }
            }, 2000),
            setTimeout(() => {
                if (this.status === 'active') {
                    this.callbacks?.onCue({ timing: 0, type: 'count', text: '1', priority: 'immediate', exerciseIndex: this.currentExerciseIndex }, '1');
                }
            }, 3000),
            setTimeout(() => {
                if (this.status === 'active') {
                    this.callbacks?.onCue({ timing: 0, type: 'instruction', text: 'Go!', priority: 'immediate', exerciseIndex: this.currentExerciseIndex }, 'Go!');
                    // Start timer after countdown completes
                    this.callbacks?.onTimerControl?.('start', this.currentExerciseIndex);
                }
            }, 4000)
        );
    }
    
    /**
     * Get the current rep count and target
     */
    getRepProgress(): { current: number; target: number; averageDuration: number } {
        return {
            current: this.currentRep,
            target: this.targetReps,
            averageDuration: this.averageRepDuration
        };
    }

    /**
     * Get current progress
     */
    getProgress(): GuidanceProgress {
        const elapsed = this.status === 'paused' 
            ? this.pauseTime - this.startTime - this.totalPausedDuration
            : this.status === 'active'
                ? Date.now() - this.startTime - this.totalPausedDuration
                : 0;

        const totalDuration = this.cues.length > 0 
            ? Math.max(...this.cues.map(c => c.timing)) * this.paceMultiplier
            : 0;

        const completedExercises = this.exercises
            .slice(0, this.currentExerciseIndex)
            .map(e => e.name);

        return {
            status: this.status,
            activityType: this.activityType,
            currentExerciseIndex: this.currentExerciseIndex,
            totalExercises: this.exercises.length,
            currentCueIndex: this.currentCueIndex,
            totalCues: this.cues.length,
            elapsedTime: elapsed,
            remainingTime: Math.max(0, totalDuration - elapsed),
            currentExerciseName: this.exercises[this.currentExerciseIndex]?.name,
            nextExerciseName: this.exercises[this.currentExerciseIndex + 1]?.name,
            isPaused: this.status === 'paused',
            pausedAt: this.status === 'paused' ? this.pauseTime : undefined,
            completedExercises
        };
    }
    
    /**
     * Get detailed state for persistence (includes cue-level and rep timing data)
     */
    getDetailedState(): {
        currentCueIndex: number;
        scheduledCues: Array<{ cueIndex: number; scheduledFor: number }>;
        repTimings: number[];
        averageRepDuration: number;
        currentRep: number;
        targetReps: number;
        startTime: number;
        totalPausedDuration: number;
        status: GuidanceStatus;
    } {
        return {
            currentCueIndex: this.currentCueIndex,
            scheduledCues: this.scheduledCues.map(sc => ({
                cueIndex: this.cues.indexOf(sc.cue),
                scheduledFor: sc.scheduledFor
            })),
            repTimings: [...this.repTimings],
            averageRepDuration: this.averageRepDuration,
            currentRep: this.currentRep,
            targetReps: this.targetReps,
            startTime: this.startTime,
            totalPausedDuration: this.totalPausedDuration,
            status: this.status
        };
    }
    
    /**
     * Restore detailed state (for seamless resume)
     */
    restoreDetailedState(state: {
        currentCueIndex: number;
        scheduledCues: Array<{ cueIndex: number; scheduledFor: number }>;
        repTimings: number[];
        averageRepDuration: number;
        currentRep: number;
        targetReps: number;
        startTime: number;
        totalPausedDuration: number;
        status: GuidanceStatus;
    }): void {
        if (this.status !== 'idle' && this.status !== 'paused') {
            console.warn('GuidanceExecutor: Cannot restore state when not idle/paused');
            return;
        }
        
        this.currentCueIndex = state.currentCueIndex;
        this.repTimings = [...state.repTimings];
        this.averageRepDuration = state.averageRepDuration;
        this.currentRep = state.currentRep;
        this.targetReps = state.targetReps;
        this.startTime = state.startTime;
        this.totalPausedDuration = state.totalPausedDuration;
        this.status = state.status;
        
        // Reschedule cues if status was active/paused
        if (state.status === 'active' || state.status === 'paused') {
            // Clear existing scheduled cues
            this.clearScheduledCues();
            
            // Reschedule remaining cues
            const now = Date.now();
            state.scheduledCues.forEach(({ cueIndex, scheduledFor }) => {
                if (cueIndex >= 0 && cueIndex < this.cues.length) {
                    const cue = this.cues[cueIndex];
                    const delay = scheduledFor - now;
                    
                    if (delay > 0) {
                        const timerId = setTimeout(() => {
                            this.executeCue(cue);
                            this.currentCueIndex = cueIndex + 1;
                        }, delay);
                        
                        this.scheduledCues.push({
                            cue,
                            timerId,
                            scheduledFor
                        });
                    }
                }
            });
        }
        
        console.log('GuidanceExecutor: Restored detailed state', {
            cueIndex: this.currentCueIndex,
            exerciseIndex: this.currentExerciseIndex,
            status: this.status
        });
    }

    /**
     * Reset the executor
     */
    reset(): void {
        this.clearScheduledCues();
        this.stopProgressUpdates();
        this.cues = [];
        this.currentCueIndex = 0;
        this.currentExerciseIndex = 0;
        this.startTime = 0;
        this.pauseTime = 0;
        this.totalPausedDuration = 0;
        this.status = 'idle';
        this.activityType = '';
        this.exercises = [];
        this.paceMultiplier = 1.0;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PRIVATE METHODS
    // ──────────────────────────────────────────────────────────────────────────

    private getPaceMultiplier(pace: 'slow' | 'normal' | 'fast'): number {
        switch (pace) {
            case 'slow': return 1.5;
            case 'fast': return 0.75;
            default: return 1.0;
        }
    }

    private scheduleCues(): void {
        const now = Date.now();
        
        this.cues.forEach((cue, index) => {
            const delay = (cue.timing * this.paceMultiplier) - (now - this.startTime);
            
            if (delay > 0) {
                const timerId = setTimeout(() => {
                    this.executeCue(cue);
                    this.currentCueIndex = index + 1;
                }, delay);
                
                this.scheduledCues.push({
                    cue,
                    timerId,
                    scheduledFor: now + delay
                });
            }
        });
    }

    private scheduleRemainingCues(): void {
        const now = Date.now();
        const elapsed = now - this.startTime - this.totalPausedDuration;
        
        this.cues.slice(this.currentCueIndex).forEach((cue, relativeIndex) => {
            const adjustedTiming = cue.timing * this.paceMultiplier;
            const delay = adjustedTiming - elapsed;
            
            if (delay > 0) {
                const timerId = setTimeout(() => {
                    this.executeCue(cue);
                    this.currentCueIndex = this.currentCueIndex + relativeIndex + 1;
                }, delay);
                
                this.scheduledCues.push({
                    cue,
                    timerId,
                    scheduledFor: now + delay
                });
            }
        });
    }

    private clearScheduledCues(): void {
        this.scheduledCues.forEach(sc => clearTimeout(sc.timerId));
        this.scheduledCues = [];
    }
    
    /** Clear any pending 3‑2‑1‑Go countdown timers */
    private clearCountdownTimers(): void {
        this.countdownTimers.forEach(id => clearTimeout(id));
        this.countdownTimers = [];
    }
    
    /**
     * Reschedule remaining cues for current exercise when adaptive pacing changes
     */
    private rescheduleCurrentExerciseCues(oldPace: number, newPace: number): void {
        if (this.currentExerciseIndex === undefined) return;
        
        const paceRatio = newPace / oldPace;
        const now = Date.now();
        const elapsed = now - this.startTime - this.totalPausedDuration;
        
        // Find cues for current exercise that haven't fired yet
        const currentExerciseCues = this.cues.filter((cue, index) => 
            cue.exerciseIndex === this.currentExerciseIndex && 
            index >= this.currentCueIndex &&
            (cue.timing * this.paceMultiplier) > elapsed
        );
        
        if (currentExerciseCues.length === 0) return;
        
        console.log(`GuidanceExecutor: Rescheduling ${currentExerciseCues.length} cues for current exercise with new pace (ratio: ${paceRatio.toFixed(2)})`);
        
        // Clear existing scheduled cues for current exercise
        this.scheduledCues = this.scheduledCues.filter(sc => {
            const isCurrentExerciseCue = sc.cue.exerciseIndex === this.currentExerciseIndex;
            if (isCurrentExerciseCue) {
                clearTimeout(sc.timerId);
                return false; // Remove from array
            }
            return true; // Keep other cues
        });
        
        // Reschedule with adjusted timing
        currentExerciseCues.forEach((cue, relativeIndex) => {
            const originalDelay = (cue.timing * this.paceMultiplier) - elapsed;
            const adjustedDelay = originalDelay * paceRatio;
            
            if (adjustedDelay > 0) {
                const timerId = setTimeout(() => {
                    this.executeCue(cue);
                    const absoluteIndex = this.cues.indexOf(cue);
                    if (absoluteIndex !== -1) {
                        this.currentCueIndex = absoluteIndex + 1;
                    }
                }, adjustedDelay);
                
                this.scheduledCues.push({
                    cue,
                    timerId,
                    scheduledFor: now + adjustedDelay
                });
            }
        });
    }

    private executeCue(cue: GuidanceCue): void {
        if (this.status !== 'active') return;

        // Track exercise transitions
        if (cue.exerciseIndex !== undefined && cue.exerciseIndex !== this.currentExerciseIndex) {
            const prevExercise = this.exercises[this.currentExerciseIndex];
            if (prevExercise) {
                // Stop timer for previous exercise
                this.callbacks?.onTimerControl?.('stop', this.currentExerciseIndex);
                this.callbacks?.onExerciseComplete(prevExercise.name, this.currentExerciseIndex);
            }
            
            this.currentExerciseIndex = cue.exerciseIndex;
            const newExercise = this.exercises[this.currentExerciseIndex];
            if (newExercise) {
                this.callbacks?.onExerciseStart(newExercise.name, this.currentExerciseIndex);
                // Reset timer for new exercise (will be started on "Go!" cue)
                const duration = this.getExerciseDuration(newExercise);
                this.callbacks?.onTimerControl?.('reset', this.currentExerciseIndex, duration);
            }
        }

        // Execute the cue
        this.callbacks?.onCue(cue, cue.text);

        // Trigger timer start on "Go!" cues (countdown completion)
        if (cue.text.toLowerCase().includes('go!') && cue.exerciseIndex !== undefined) {
            // End any rest period when new exercise starts
            this.callbacks?.onRestPeriod?.('end', cue.exerciseIndex);
            this.callbacks?.onTimerControl?.('start', cue.exerciseIndex);
        }

        // Trigger rest period when rest cue is detected
        if (cue.type === 'rest' && cue.exerciseIndex !== undefined) {
            // Parse rest duration from cue text (e.g., "Rest for 30 seconds")
            const restMatch = cue.text.match(/(\d+)\s*seconds?/i);
            const restDuration = restMatch ? parseInt(restMatch[1]) : 30;
            
            // Stop exercise timer and start rest timer
            this.callbacks?.onTimerControl?.('stop', cue.exerciseIndex);
            this.callbacks?.onRestPeriod?.('start', cue.exerciseIndex, restDuration);
        }

        // Check for completion
        if (cue.type === 'completion') {
            this.complete();
        }
    }
    
    /**
     * Get exercise duration in seconds
     */
    private getExerciseDuration(exercise: Exercise): number {
        if (exercise.duration) {
            const match = exercise.duration.match(/(\d+)/);
            if (match) {
                const num = parseInt(match[1]);
                if (exercise.duration.toLowerCase().includes('min')) {
                    return num * 60;
                }
                return num;
            }
        }
        if (exercise.reps) {
            const repCount = parseInt(exercise.reps) || 10;
            return repCount * 2.5; // Approximate 2.5 seconds per rep
        }
        return 30; // Default 30 seconds
    }

    private complete(): void {
        this.status = 'completed';
        this.clearScheduledCues();
        this.clearCountdownTimers();
        this.stopProgressUpdates();
        
        // Mark last exercise complete
        const lastExercise = this.exercises[this.currentExerciseIndex];
        if (lastExercise) {
            this.callbacks?.onExerciseComplete(lastExercise.name, this.currentExerciseIndex);
        }
        
        this.callbacks?.onActivityComplete();
        console.log('GuidanceExecutor: Activity completed');
    }

    private startProgressUpdates(): void {
        this.stopProgressUpdates();
        this.progressInterval = setInterval(() => {
            this.updateProgress();
        }, 1000);
    }

    private stopProgressUpdates(): void {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    private updateProgress(): void {
        this.callbacks?.onProgressUpdate(this.getProgress());
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let executorInstance: GuidanceExecutor | null = null;

export function getGuidanceExecutor(): GuidanceExecutor {
    if (!executorInstance) {
        executorInstance = new GuidanceExecutor();
    }
    return executorInstance;
}

export function resetGuidanceExecutor(): void {
    if (executorInstance) {
        executorInstance.reset();
    }
    executorInstance = null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a VoiceGuidanceConfig from startGuidedActivity args
 */
export function createGuidanceConfig(
    activityType: string,
    args: any
): VoiceGuidanceConfig {
    const config: VoiceGuidanceConfig = {
        activity: activityType as any,
        pace: args.pace || 'normal'
    };

    if (activityType === 'workout' || activityType === 'stretching') {
        config.exercises = args.exercises?.map((e: any) => ({
            name: e.name,
            reps: e.reps,
            duration: e.duration,
            restAfter: e.restAfter || 30
        })) || [];
    }

    if (activityType === 'breathing') {
        const patternName = args.breathingPattern || 'box';
        config.pattern = BREATHING_PATTERNS[patternName] || BREATHING_PATTERNS.box;
    }

    if (activityType === 'meditation') {
        const minutes = args.durationMinutes || 5;
        config.intervals = [{ work: minutes * 60, rest: 0 }];
    }

    if (activityType === 'timer') {
        const seconds = args.durationSeconds || args.duration || 60;
        config.intervals = [{ work: seconds, rest: 0 }];
        (config as any).label = args.label || 'Timer';
    }

    return config;
}

/**
 * Generate voice selection options from a workout list
 */
export function generateVoiceOptionsFromWorkout(
    exercises: Array<{ name: string; reps?: string; duration?: string }>,
    workoutTitle: string
): import('../types').SelectionOption[] {
    // For a single workout, create selection options for start/modify/cancel
    return [
        {
            id: 'start_workout',
            label: `Start ${workoutTitle}`,
            index: 0,
            synonyms: ['start', 'begin', 'go', "let's go", 'ready', 'yes'],
            data: { action: 'start', exercises, title: workoutTitle }
        },
        {
            id: 'modify_workout',
            label: 'Modify workout',
            index: 1,
            synonyms: ['change', 'modify', 'different', 'adjust'],
            data: { action: 'modify' }
        },
        {
            id: 'cancel',
            label: 'Cancel',
            index: 2,
            synonyms: ['cancel', 'no', 'never mind', 'stop'],
            data: { action: 'cancel' }
        }
    ];
}

/**
 * Generate voice selection options from multiple workout options
 */
export function generateVoiceOptionsFromList(
    items: Array<{ id: string; title: string; exercises?: any[]; description?: string }>,
): import('../types').SelectionOption[] {
    return items.map((item, index) => ({
        id: item.id,
        label: item.title,
        index,
        synonyms: generateSynonyms(item.title),
        data: { type: 'workout', ...item }
    }));
}

/**
 * Generate synonyms for a workout title
 */
function generateSynonyms(title: string): string[] {
    const synonyms: string[] = [];
    const lower = title.toLowerCase();
    
    // Add the title itself
    synonyms.push(lower);
    
    // Add common variations
    if (lower.includes('morning')) synonyms.push('morning one', 'the morning');
    if (lower.includes('evening')) synonyms.push('evening one', 'the evening');
    if (lower.includes('quick')) synonyms.push('quick one', 'the quick');
    if (lower.includes('full')) synonyms.push('full one', 'the full');
    if (lower.includes('hiit')) synonyms.push('hiit', 'high intensity', 'intense');
    if (lower.includes('yoga')) synonyms.push('yoga', 'stretching', 'flexibility');
    if (lower.includes('strength')) synonyms.push('strength', 'weights', 'lifting');
    if (lower.includes('cardio')) synonyms.push('cardio', 'running', 'aerobic');
    
    return synonyms;
}
