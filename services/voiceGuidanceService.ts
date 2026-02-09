/**
 * Voice Guidance Service
 * 
 * Generates timing-based audio cues for workouts, breathing exercises,
 * and meditation sessions. Provides hands-free guidance during activities.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type ActivityType = 'workout' | 'breathing' | 'meditation' | 'stretching' | 'timer';
export type CueType = 'count' | 'instruction' | 'motivation' | 'transition' | 'completion' | 'rest';
export type CuePriority = 'immediate' | 'queued';

export interface Exercise {
    name: string;
    reps?: string;
    duration?: string;
    restAfter?: number; // seconds
}

export interface BreathingPattern {
    name: string;
    inhale: number;      // seconds
    hold?: number;       // seconds (optional)
    exhale: number;      // seconds
    holdEmpty?: number;  // seconds (optional)
    cycles: number;
}

export interface VoiceGuidanceConfig {
    activity: ActivityType;
    exercises?: Exercise[];
    pattern?: BreathingPattern;
    intervals?: { work: number; rest: number }[];
    pace?: 'slow' | 'normal' | 'fast';
    /**
     * High-level guidance density for mindful sessions.
     * - 'full': rich prompts throughout (default)
     * - 'light': primarily phase boundaries + a few check-ins
     * - 'silent': only opening/closing cues (or minimal speech)
     */
    guidanceStyle?: 'full' | 'light' | 'silent';
    /**
     * Optional semantic intent for mindful timers. This mirrors
     * MindfulSessionConfig.intent but is kept lightweight here to
     * avoid a hard dependency on the session generator module.
     */
    intent?: 'breathing_reset' | 'deep_meditation' | 'sleep_prep' | 'focus_block';
}

export interface GuidanceCue {
    timing: number;       // ms from activity start
    type: CueType;
    text: string;         // What Zen should say
    priority: CuePriority;
    exerciseIndex?: number; // For workout tracking
}

// ============================================================================
// PRESET BREATHING PATTERNS
// ============================================================================

export const BREATHING_PATTERNS: Record<string, BreathingPattern> = {
    box: {
        name: 'Box Breathing',
        inhale: 4,
        hold: 4,
        exhale: 4,
        holdEmpty: 4,
        cycles: 4
    },
    relaxing: {
        name: '4-7-8 Relaxing Breath',
        inhale: 4,
        hold: 7,
        exhale: 8,
        cycles: 4
    },
    energizing: {
        name: 'Energizing Breath',
        inhale: 4,
        exhale: 4,
        cycles: 10
    },
    calming: {
        name: 'Calming Breath',
        inhale: 4,
        exhale: 6,
        cycles: 6
    },
    focus: {
        name: 'Focus Breath',
        inhale: 4,
        hold: 4,
        exhale: 4,
        cycles: 5
    }
};

// ============================================================================
// PACE MULTIPLIERS
// ============================================================================

const PACE_MULTIPLIERS: Record<string, number> = {
    slow: 1.5,
    normal: 1.0,
    fast: 0.75
};

// ============================================================================
// WORLD-CLASS COACHING PHRASES
// ============================================================================

const MOTIVATIONAL_PHRASES = {
    workout: [
        // Power & Energy
        "That's it! Feel the power!",
        "Strong and steady, you've got this!",
        "Push through, the burn means it's working!",
        "Excellent control! Keep that form tight!",
        "You're building strength with every rep!",
        "Stay with me, we're doing this together!",
        "Beautiful form! Now let's go deeper!",
        "This is where champions are made!",
        // Encouragement
        "I see you fighting for it, that's the spirit!",
        "Every single rep counts. Make it count!",
        "You're stronger than you think!",
        "Breathe and power through!",
        "That's the intensity I want to see!",
        "Feel your muscles working, that's growth!"
    ],
    breathing: [
        // Calming guidance
        "Beautiful rhythm, just like that.",
        "You're finding your center.",
        "Let each breath bring you deeper calm.",
        "Feel the peace flowing through you.",
        "Perfect flow, you're doing wonderfully.",
        "Your breath is your anchor.",
        "Stay with this gentle rhythm.",
        "Notice how calm is settling in.",
        "Each breath releases more tension.",
        "You're creating space within yourself."
    ],
    meditation: [
        // Expert mindfulness coaching
        "Let thoughts pass like clouds in an open sky.",
        "Gently return your attention to your breath.",
        "You're fully present in this moment.",
        "This moment is yours, completely yours.",
        "Continue breathing naturally, I'm right here.",
        "Stay with your breath, nothing else matters.",
        "You're doing beautifully, just be.",
        "Notice, accept, and let go.",
        "Simply breathe, that's all you need to do.",
        "You're exactly where you need to be.",
        "Feel the stillness within you.",
        "Your only job right now is to breathe.",
        "Let go of any tension you're holding.",
        "Be kind to yourself in this moment."
    ],
    stretching: [
        // Flexibility & release
        "Breathe deeply into the stretch.",
        "Let the tension melt away.",
        "Feel your muscles lengthening.",
        "Honor what your body needs today.",
        "Relax into it, don't force it.",
        "Each breath takes you a little deeper.",
        "Beautiful, hold that stretch.",
        "Feel the release, that's flexibility building."
    ]
};

// Exercise-specific coaching cues (mid-exercise encouragement)
const EXERCISE_COACHING: Record<string, string[]> = {
    // Common exercises with specific form cues
    'push-up': ['Chest to the floor, nice and controlled!', 'Keep your core tight, back flat!', 'Full range of motion, let\'s go!'],
    'pushup': ['Chest to the floor, nice and controlled!', 'Keep your core tight, back flat!', 'Full range of motion, let\'s go!'],
    'squat': ['Sit back like there\'s a chair behind you!', 'Knees tracking over toes, chest up!', 'Drive through your heels!'],
    'plank': ['Squeeze everything tight, you\'re a steel beam!', 'Don\'t let those hips drop!', 'Breathe steady, hold strong!'],
    'lunge': ['Step forward with control, knee over ankle!', 'Keep that front knee stable!', 'Push through the heel to stand!'],
    'burpee': ['Explode up! That\'s the power I want!', 'Fast hands, fast feet!', 'Full extension at the top!'],
    'jumping jack': ['Arms and legs in sync, stay light on your feet!', 'Keep the pace steady!', 'Nice and rhythmic!'],
    'crunch': ['Curl up from the core, not the neck!', 'Feel those abs engage!', 'Controlled movement, no momentum!'],
    'mountain climber': ['Drive those knees, keep it fast!', 'Hips down, core engaged!', 'That\'s cardio and core together!'],
    'default': ['Focus on form over speed!', 'Control the movement!', 'You\'re getting stronger with every rep!']
};

// Full form instructions for exercises (spoken before starting)
const EXERCISE_FORM_INSTRUCTIONS: Record<string, string> = {
    'push-up': 'Hands shoulder-width apart, core tight, lower your chest to the ground and push back up. Full range of motion.',
    'pushup': 'Hands shoulder-width apart, core tight, lower your chest to the ground and push back up. Full range of motion.',
    'push up': 'Hands shoulder-width apart, core tight, lower your chest to the ground and push back up. Full range of motion.',
    'squat': 'Feet shoulder-width apart, sit back and down like sitting in a chair, keep your chest up, then drive through your heels to stand.',
    'plank': 'Forearms on the ground, body in a straight line from head to heels. Squeeze your core and glutes, breathe steadily.',
    'lunge': 'Step forward, lower your back knee toward the ground, keep front knee over ankle, then push back to start.',
    'burpee': 'Drop to a push-up, jump your feet to your hands, then explode up with arms overhead.',
    'jumping jack': 'Jump your feet out wide while raising arms overhead, then jump back together. Light on your feet, find a rhythm.',
    'jumping jacks': 'Jump your feet out wide while raising arms overhead, then jump back together. Light on your feet, find a rhythm.',
    'crunch': 'Lie on your back, knees bent, curl your shoulders off the ground using your abs. Keep your neck relaxed.',
    'sit-up': 'Lie on your back, knees bent, engage your core to lift your torso all the way up, then lower with control.',
    'situp': 'Lie on your back, knees bent, engage your core to lift your torso all the way up, then lower with control.',
    'mountain climber': 'Start in a plank position, drive your knees toward your chest alternating quickly. Keep your hips down.',
    'mountain climbers': 'Start in a plank position, drive your knees toward your chest alternating quickly. Keep your hips down.',
    'deadlift': 'Feet hip-width, hinge at the hips, keep back flat, grip the weight and stand by driving through your heels.',
    'bicep curl': 'Keep your elbows pinned to your sides, curl the weight up, squeeze at the top, lower with control.',
    'tricep dip': 'Hands on a surface behind you, lower your body by bending elbows to 90 degrees, then push back up.',
    'leg raise': 'Lie flat, keep legs straight, lift them toward the ceiling using your lower abs, lower with control.',
    'russian twist': 'Sit with knees bent, lean back slightly, rotate your torso side to side touching the ground each side.',
    'high knees': 'Run in place, driving your knees up toward your chest as high as possible. Pump your arms.',
    'butt kick': 'Run in place, kicking your heels back toward your glutes. Keep a quick pace.',
    'butt kicks': 'Run in place, kicking your heels back toward your glutes. Keep a quick pace.',
    'wall sit': 'Back flat against the wall, slide down until thighs are parallel to the floor. Hold this position.',
    'box jump': 'Stand facing the box, bend your knees and swing your arms, then explode up landing softly on the box.',
    'step up': 'Step onto the platform with one foot, drive through that heel to stand, then step back down. Alternate legs.',
    'default': 'Focus on controlled movement and proper form throughout each rep.'
};

function getExerciseFormInstruction(exerciseName: string): string {
    const nameLower = exerciseName.toLowerCase();
    for (const [key, instruction] of Object.entries(EXERCISE_FORM_INSTRUCTIONS)) {
        if (nameLower.includes(key)) {
            return instruction;
        }
    }
    return EXERCISE_FORM_INSTRUCTIONS.default;
}

function getExerciseCoaching(exerciseName: string): string {
    const nameLower = exerciseName.toLowerCase();
    for (const [key, phrases] of Object.entries(EXERCISE_COACHING)) {
        if (nameLower.includes(key)) {
            return phrases[Math.floor(Math.random() * phrases.length)];
        }
    }
    return EXERCISE_COACHING.default[Math.floor(Math.random() * EXERCISE_COACHING.default.length)];
}

function getRandomMotivation(activity: ActivityType): string {
    const phrases = MOTIVATIONAL_PHRASES[activity] || MOTIVATIONAL_PHRASES.workout;
    return phrases[Math.floor(Math.random() * phrases.length)];
}

// ============================================================================
// CUE GENERATION FUNCTIONS
// ============================================================================

/**
 * Generate cues for a workout session with exercises.
 * World-class trainer style with precise, motivating instructions.
 */
function generateWorkoutCues(
    exercises: Exercise[],
    pace: number = 1.0
): GuidanceCue[] {
    const cues: GuidanceCue[] = [];
    let currentTime = 0;

    // Powerful opening - set the tone
    cues.push({
        timing: 0,
        type: 'instruction',
        text: `Alright! ${exercises.length} exercises ahead of you. Stay focused, trust the process, and let's make every rep count!`,
        priority: 'immediate'
    });

    currentTime += 4000 * pace; // 4 second intro for the longer message

    // Brief pause before starting
    cues.push({
        timing: currentTime,
        type: 'instruction',
        text: "Take a deep breath... and let's begin!",
        priority: 'immediate'
    });

    currentTime += 3000 * pace;

    exercises.forEach((exercise, index) => {
        const exerciseName = exercise.name;
        const isLast = index === exercises.length - 1;
        const isFirst = index === 0;
        const exerciseNumber = index + 1;

        // Smooth transition announcement
        if (isFirst) {
            cues.push({
                timing: currentTime,
                type: 'transition',
                text: `First exercise: ${exerciseName}.`,
                priority: 'immediate',
                exerciseIndex: index
            });
        } else {
            // Dynamic transitions based on position in workout
            const transitionText = isLast 
                ? `Final exercise! ${exerciseName}. Give me everything you've got!`
                : `Next up: ${exerciseName}. Exercise ${exerciseNumber} of ${exercises.length}.`;
            
            cues.push({
                timing: currentTime,
                type: 'transition',
                text: transitionText,
                priority: 'immediate',
                exerciseIndex: index
            });
        }

        currentTime += 2000 * pace;

        // Form instruction for the exercise
        const formInstruction = getExerciseFormInstruction(exerciseName);
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: formInstruction,
            priority: 'immediate',
            exerciseIndex: index
        });

        currentTime += 4000 * pace; // Time for form instruction

        // Ready countdown for all exercises - split into separate cues for clear TTS
        // This prevents numbers from being skipped when sent as one string
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: "Get set...",
            priority: 'immediate',
            exerciseIndex: index
        });
        
        currentTime += 1000 * pace; // 1 second for "Get set..."
        
        // Countdown: 3, 2, 1 - each as separate cue with 1 second spacing
        cues.push({
            timing: currentTime,
            type: 'count',
            text: "3",
            priority: 'immediate',
            exerciseIndex: index
        });
        
        currentTime += 1000 * pace; // 1 second for "3"
        
        cues.push({
            timing: currentTime,
            type: 'count',
            text: "2",
            priority: 'immediate',
            exerciseIndex: index
        });
        
        currentTime += 1000 * pace; // 1 second for "2"
        
        cues.push({
            timing: currentTime,
            type: 'count',
            text: "1",
            priority: 'immediate',
            exerciseIndex: index
        });
        
        currentTime += 1000 * pace; // 1 second for "1"
        
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: "Go!",
            priority: 'immediate',
            exerciseIndex: index
        });
        
        currentTime += 1000 * pace; // 1 second for "Go!"

        // Rep counting (if reps specified)
        if (exercise.reps) {
            const repCount = parseInt(exercise.reps) || 10;
            const repInterval = 2500 * pace; // 2.5 seconds per rep for better pacing

            for (let rep = 1; rep <= repCount; rep++) {
                cues.push({
                    timing: currentTime,
                    type: 'count',
                    text: rep.toString(),
                    priority: 'queued',
                    exerciseIndex: index
                });

                // Add coaching cues strategically
                if (rep === 3 && repCount >= 8) {
                    // Early form check
                    cues.push({
                        timing: currentTime + repInterval * 0.5,
                        type: 'motivation',
                        text: getExerciseCoaching(exerciseName),
                        priority: 'queued',
                        exerciseIndex: index
                    });
                }
                
                if (rep === Math.floor(repCount / 2)) {
                    // Halfway encouragement
                    cues.push({
                        timing: currentTime + repInterval * 0.6,
                        type: 'motivation',
                        text: `Halfway! ${repCount - rep} more, you've got this!`,
                        priority: 'queued',
                        exerciseIndex: index
                    });
                }
                
                if (rep === repCount - 2 && repCount >= 5) {
                    // Building to finish
                    cues.push({
                        timing: currentTime + repInterval * 0.5,
                        type: 'motivation',
                        text: "Almost there, finish strong!",
                        priority: 'queued',
                        exerciseIndex: index
                    });
                }
                
                if (rep === repCount) {
                    // Final rep emphasis
                    cues.push({
                        timing: currentTime - repInterval * 0.3,
                        type: 'motivation',
                        text: "Last one, make it count!",
                        priority: 'immediate',
                        exerciseIndex: index
                    });
                }

                currentTime += repInterval;
            }
        } else if (exercise.duration) {
            // Duration-based exercise (holds, planks, etc.)
            const durationSec = parseDuration(exercise.duration);
            
            cues.push({
                timing: currentTime,
                type: 'instruction',
                text: `Hold strong for ${durationSec} seconds. Find your focus...`,
                priority: 'immediate',
                exerciseIndex: index
            });

            // Quarter check-in
            if (durationSec >= 30) {
                cues.push({
                    timing: currentTime + (durationSec * 250),
                    type: 'motivation',
                    text: getExerciseCoaching(exerciseName),
                    priority: 'queued',
                    exerciseIndex: index
                });
            }

            // Halfway
            if (durationSec >= 15) {
                cues.push({
                    timing: currentTime + (durationSec * 500),
                    type: 'motivation',
                    text: "Halfway point! Stay strong, control your breathing!",
                    priority: 'queued',
                    exerciseIndex: index
                });
            }

            // Final countdown
            if (durationSec >= 10) {
                cues.push({
                    timing: currentTime + (durationSec * 1000) - 10000,
                    type: 'motivation',
                    text: "Ten seconds left, push through!",
                    priority: 'queued',
                    exerciseIndex: index
                });
                
                // 5 second countdown - split into separate cues for clear TTS
                const countdownStartTime = currentTime + (durationSec * 1000) - 5000;
                const countdownNumbers = ['Five', 'Four', 'Three', 'Two', 'One'];
                countdownNumbers.forEach((num, idx) => {
                    cues.push({
                        timing: countdownStartTime + (idx * 1000),
                        type: 'count',
                        text: idx === countdownNumbers.length - 1 ? `${num}!` : num,
                        priority: 'immediate',
                        exerciseIndex: index
                    });
                });
            }

            currentTime += durationSec * 1000;
        }

        // Exercise completion with varied responses
        const completionPhrases = isLast 
            ? ["And... done! That's the workout!", "Complete! You crushed it!", "Finished! What a session!"]
            : ["Done! Excellent work!", "Complete! That was strong!", "Perfect! Great execution!"];
        
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: completionPhrases[Math.floor(Math.random() * completionPhrases.length)],
            priority: 'immediate',
            exerciseIndex: index
        });

        currentTime += 2000 * pace;

        // Rest period with guidance
        const restDuration = exercise.restAfter || (isLast ? 0 : 30);
        if (restDuration > 0) {
            cues.push({
                timing: currentTime,
                type: 'rest',
                text: `Rest for ${restDuration} seconds. Shake it out, catch your breath.`,
                priority: 'immediate',
                exerciseIndex: index
            });

            // Mid-rest motivation for longer rests
            if (restDuration >= 20) {
                cues.push({
                    timing: currentTime + (restDuration * 500),
                    type: 'motivation',
                    text: "Use this time to recover. Next exercise coming up.",
                    priority: 'queued',
                    exerciseIndex: index
                });
            }

            // 10 second warning
            if (restDuration >= 15) {
                cues.push({
                    timing: currentTime + (restDuration - 10) * 1000,
                    type: 'instruction',
                    text: "Ten seconds, get ready!",
                    priority: 'queued',
                    exerciseIndex: index
                });
            }

            // 5 second countdown - split into separate cues for clear TTS
            if (restDuration > 5) {
                const countdownStartTime = currentTime + (restDuration - 5) * 1000;
                
                // Each number as separate cue with 1 second spacing
                const countdownNumbers = ['Five', 'Four', 'Three', 'Two', 'One'];
                countdownNumbers.forEach((num, idx) => {
                    cues.push({
                        timing: countdownStartTime + (idx * 1000),
                        type: 'count',
                        text: num,
                        priority: 'immediate',
                        exerciseIndex: index
                    });
                });
            }

            currentTime += restDuration * 1000;
        }
    });

    // Powerful completion message
    cues.push({
        timing: currentTime,
        type: 'completion',
        text: `Workout complete! ${exercises.length} exercises done! ${getRandomMotivation('workout')} Take a moment to be proud of yourself.`,
        priority: 'immediate'
    });

    return cues;
}

/**
 * Generate cues for a breathing exercise.
 * Expert mindfulness coaching with smooth, calming transitions.
 */
function generateBreathingCues(
    pattern: BreathingPattern,
    pace: number = 1.0,
    targetDurationSeconds?: number
): GuidanceCue[] {
    const estimateDurationMs = (cycles: number) => {
        const active = pattern.inhale + (pattern.hold || 0) + pattern.exhale + (pattern.holdEmpty || 0);
        const promptGaps =
            0.5 + // inhale prompt gap
            (pattern.hold ? 0.5 : 0) +
            0.5 + // exhale prompt gap
            (pattern.holdEmpty ? 0.5 : 0);
        const perCycle = (active + promptGaps) * 1000 * pace;
        const opening = 14000 * pace;
        const closing = 4000 * pace;
        const transitionGaps = Math.max(0, cycles - 1) * (1000 * pace);
        return opening + (cycles * perCycle) + transitionGaps + closing;
    };

    const targetMs = targetDurationSeconds && targetDurationSeconds > 0
        ? targetDurationSeconds * 1000
        : undefined;

    let effectiveCycles = pattern.cycles;
    if (targetMs) {
        const maxCycles = Math.max(1, Math.ceil((targetDurationSeconds || 1) / Math.max(1, pattern.inhale + pattern.exhale)) + 4);
        let bestCycles = 1;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (let cycles = 1; cycles <= maxCycles; cycles++) {
            const delta = Math.abs(estimateDurationMs(cycles) - targetMs);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestCycles = cycles;
            }
        }
        effectiveCycles = bestCycles;
    }

    const effectivePattern = { ...pattern, cycles: effectiveCycles };
    const cues: GuidanceCue[] = [];
    let currentTime = 0;

    // Gentle, grounding opening
    cues.push({
        timing: 0,
        type: 'instruction',
        text: `Welcome to ${pattern.name}. Find a comfortable position, let your shoulders drop, and gently close your eyes.`,
        priority: 'immediate'
    });

    currentTime += 5000 * pace;

    cues.push({
        timing: currentTime,
        type: 'instruction',
        text: "Take a moment to notice your breath as it is right now... no need to change anything yet.",
        priority: 'immediate'
    });

    currentTime += 5000 * pace;

    cues.push({
        timing: currentTime,
        type: 'instruction',
        text: `We'll move through ${effectivePattern.cycles} cycles together. Let me guide you.`,
        priority: 'immediate'
    });

    currentTime += 4000 * pace;

    for (let cycle = 1; cycle <= effectivePattern.cycles; cycle++) {
        const isFirst = cycle === 1;
        const isLast = cycle === effectivePattern.cycles;
        const isMidpoint = cycle === Math.ceil(effectivePattern.cycles / 2);

        // Cycle announcement for later cycles (not first)
        if (!isFirst && (isMidpoint || isLast)) {
            const cycleText = isLast 
                ? "Final cycle. Make this one count."
                : `Cycle ${cycle}. ${getRandomMotivation('breathing')}`;
            cues.push({
                timing: currentTime,
                type: 'motivation',
                text: cycleText,
                priority: 'queued'
            });
            currentTime += 2000 * pace;
        }

        // Inhale - varied language
        const inhalePrompts = isFirst 
            ? ["Breathe in slowly through your nose...", "Inhale gently, let your belly expand..."]
            : ["Inhale...", "Breathe in...", "Fill your lungs..."];
        
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: inhalePrompts[Math.floor(Math.random() * inhalePrompts.length)],
            priority: 'immediate'
        });

        // (Previously: per-second numeric inhale counts. Removed to avoid
        // timing drift and repeated/ skipped numbers with remote TTS.)
        currentTime += (effectivePattern.inhale * 1000 * pace) + (500 * pace); // Small gap after inhale

        // Hold (if specified)
        if (effectivePattern.hold) {
            const holdPrompts = isFirst
                ? ["Gently hold, keeping your body relaxed..."]
                : ["Hold...", "Hold gently...", "Pause here..."];
            
            cues.push({
                timing: currentTime,
                type: 'instruction',
                text: holdPrompts[Math.floor(Math.random() * holdPrompts.length)],
                priority: 'immediate'
            });

            // (Previously: per-second numeric hold counts. Removed for robustness.)
            currentTime += (effectivePattern.hold * 1000 * pace) + (500 * pace);
        }

        // Exhale - varied language
        const exhalePrompts = isFirst
            ? ["Exhale slowly, letting everything go...", "Release the breath gently..."]
            : ["Exhale...", "Breathe out...", "Let it go..."];
        
        cues.push({
            timing: currentTime,
            type: 'instruction',
            text: exhalePrompts[Math.floor(Math.random() * exhalePrompts.length)],
            priority: 'immediate'
        });

        // (Previously: per-second numeric exhale counts. Removed for robustness.)
        currentTime += (effectivePattern.exhale * 1000 * pace) + (500 * pace);

        // Hold empty (if specified)
        if (effectivePattern.holdEmpty) {
            const holdEmptyPrompts = isFirst
                ? ["Rest in the stillness, lungs empty..."]
                : ["Hold empty...", "Pause...", "Rest here..."];
            
            cues.push({
                timing: currentTime,
                type: 'instruction',
                text: holdEmptyPrompts[Math.floor(Math.random() * holdEmptyPrompts.length)],
                priority: 'immediate'
            });

            // (Previously: per-second numeric empty-hold counts. Removed for robustness.)
            currentTime += (effectivePattern.holdEmpty * 1000 * pace) + (500 * pace);
        }

        // Brief transition between cycles
        if (!isLast) {
            currentTime += 1000 * pace;
        }
    }

    // Gentle closing sequence
    cues.push({
        timing: currentTime + 1000,
        type: 'instruction',
        text: "Allow your breath to return to its natural rhythm.",
        priority: 'immediate'
    });

    currentTime += 4000 * pace;

    cues.push({
        timing: currentTime,
        type: 'completion',
        text: `Beautiful work. ${effectivePattern.cycles} cycles complete. Notice how calm and centered you feel. Carry this peace with you.`,
        priority: 'immediate'
    });

    if (targetMs && cues.length > 0) {
        const maxTiming = Math.max(...cues.map(c => c.timing));
        if (maxTiming > 0 && maxTiming !== targetMs) {
            const scale = targetMs / maxTiming;
            return cues.map(c => ({
                ...c,
                timing: Math.max(0, Math.round(c.timing * scale))
            }));
        }
    }

    return cues;
}

/**
 * Generate cues for meditation.
 * Expert mindfulness coaching with gentle, guiding presence.
 */
function generateMeditationCues(
    durationMinutes: number = 5,
    pace: number = 1.0
): GuidanceCue[] {
    const cues: GuidanceCue[] = [];
    const durationMs = durationMinutes * 60 * 1000;

    // Warm, grounding opening
    cues.push({
        timing: 0,
        type: 'instruction',
        text: `Welcome. This is your ${durationMinutes} minute meditation. Find a comfortable seat and allow your eyes to gently close.`,
        priority: 'immediate'
    });

    cues.push({
        timing: 6000 * pace,
        type: 'instruction',
        text: "Begin by taking three deep, cleansing breaths. In through your nose... and out through your mouth.",
        priority: 'immediate'
    });

    cues.push({
        timing: 14000 * pace,
        type: 'instruction',
        text: "With each exhale, release any tension you're holding.",
        priority: 'immediate'
    });

    cues.push({
        timing: 22000 * pace,
        type: 'instruction',
        text: "Now let your breath settle into its natural rhythm. You don't need to control it.",
        priority: 'immediate'
    });

    cues.push({
        timing: 32000 * pace,
        type: 'instruction',
        text: "Your only task is to notice. Notice the breath moving in and out.",
        priority: 'immediate'
    });

    // First reassurance - important for knowing guidance continues
    cues.push({
        timing: 45000 * pace,
        type: 'motivation',
        text: "You're doing perfectly. I'm right here, guiding you through this.",
        priority: 'queued'
    });

    // Calculate reminder intervals based on session length
    // Shorter sessions need more frequent check-ins
    const reminderInterval = durationMinutes <= 2 
        ? 30 * 1000    // Every 30 seconds for very short
        : durationMinutes <= 5 
            ? 45 * 1000  // Every 45 seconds for short
            : durationMinutes <= 10
                ? 60 * 1000  // Every minute for medium
                : 90 * 1000; // Every 1.5 minutes for longer
    
    let reminderTime = 60000 * pace;

    // Varied mindfulness prompts for natural flow
    const mindfulnessPrompts = [
        "If your mind has wandered, that's okay. Gently bring your attention back to your breath.",
        "Notice the sensation of air entering and leaving your body.",
        "Continue breathing naturally. You're doing beautifully.",
        "Allow any thoughts to float by like leaves on a stream.",
        "Stay present with each breath. In... and out.",
        "You're fully supported in this moment.",
        "Keep breathing. Let everything else fall away.",
        "Notice how your body feels right now. Soft. Relaxed.",
        "Each breath is an anchor to this present moment.",
        "Let go of any effort. Simply be."
    ];

    let promptIndex = 0;

    // Continue reminders until closing sequence
    while (reminderTime < durationMs - 45000) {
        cues.push({
            timing: reminderTime,
            type: promptIndex % 2 === 0 ? 'instruction' : 'motivation',
            text: mindfulnessPrompts[promptIndex % mindfulnessPrompts.length],
            priority: 'queued'
        });
        promptIndex++;
        reminderTime += reminderInterval;
    }

    // Gentle closing sequence - more gradual than before
    cues.push({
        timing: durationMs - 45000,
        type: 'instruction',
        text: "We're beginning to close. Start to deepen your breath slightly.",
        priority: 'immediate'
    });

    cues.push({
        timing: durationMs - 35000,
        type: 'instruction',
        text: "Begin to bring your awareness back to your body... the weight of your body where you're sitting.",
        priority: 'immediate'
    });

    cues.push({
        timing: durationMs - 25000,
        type: 'instruction',
        text: "Gently wiggle your fingers and toes, awakening sensation.",
        priority: 'immediate'
    });

    cues.push({
        timing: durationMs - 15000,
        type: 'instruction',
        text: "When you're ready, let your eyes softly open, taking in the light.",
        priority: 'immediate'
    });

    cues.push({
        timing: durationMs - 5000,
        type: 'instruction',
        text: "Take one more deep breath with me...",
        priority: 'immediate'
    });

    cues.push({
        timing: durationMs,
        type: 'completion',
        text: "Meditation complete. Thank you for practicing with me. Carry this stillness with you.",
        priority: 'immediate'
    });

    return cues;
}

/**
 * Generate cues for a simple timer.
 * Minimal guidance with clear end warnings.
 */
function generateTimerCues(
    durationSeconds: number,
    label: string = 'Timer',
    pace: number = 1.0
): GuidanceCue[] {
    const cues: GuidanceCue[] = [];
    const durationMs = durationSeconds * 1000;

    // Only add an opening cue for timers > 30 seconds
    if (durationSeconds > 30) {
        cues.push({
            timing: 0,
            type: 'instruction',
            text: `${label} started. ${Math.floor(durationSeconds / 60)} ${durationSeconds >= 120 ? 'minutes' : 'minute'}${durationSeconds % 60 > 0 ? ` ${durationSeconds % 60} seconds` : ''} begins now.`,
            priority: 'immediate'
        });
    }

    // Halfway check-in for longer timers (> 2 minutes)
    if (durationSeconds >= 120) {
        cues.push({
            timing: durationMs / 2,
            type: 'instruction',
            text: "Halfway there.",
            priority: 'queued'
        });
    }

    // 1 minute warning for timers > 2 minutes
    if (durationSeconds > 120) {
        cues.push({
            timing: durationMs - 60000,
            type: 'instruction',
            text: "One minute remaining.",
            priority: 'queued'
        });
    }

    // 30 second warning for timers > 1 minute
    if (durationSeconds > 60) {
        cues.push({
            timing: durationMs - 30000,
            type: 'instruction',
            text: "Thirty seconds left.",
            priority: 'queued'
        });
    }

    // 10 second warning
    if (durationSeconds > 15) {
        cues.push({
            timing: durationMs - 10000,
            type: 'instruction',
            text: "Ten seconds.",
            priority: 'queued'
        });
    }

    // 5 second countdown - split into separate cues for clear TTS
    if (durationSeconds > 5) {
        const countdownStartTime = durationMs - 5000;
        const countdownNumbers = ['Five', 'Four', 'Three', 'Two', 'One'];
        countdownNumbers.forEach((num, idx) => {
            cues.push({
                timing: countdownStartTime + (idx * 1000),
                type: 'count',
                text: num,
                priority: 'immediate'
            });
        });
    }

    // Completion
    cues.push({
        timing: durationMs,
        type: 'completion',
        text: `${label} complete!`,
        priority: 'immediate'
    });

    return cues;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse duration string to seconds.
 * Handles: "30s", "30 seconds", "1m", "1 minute", "30"
 */
function parseDuration(duration: string): number {
    const normalized = duration.toLowerCase().trim();

    // Minutes
    const minMatch = normalized.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);
    if (minMatch) {
        return parseInt(minMatch[1]) * 60;
    }

    // Seconds
    const secMatch = normalized.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/);
    if (secMatch) {
        return parseInt(secMatch[1]);
    }

    // Plain number (assume seconds)
    const plainNum = parseInt(normalized);
    if (!isNaN(plainNum)) {
        return plainNum;
    }

    return 30; // Default 30 seconds
}

/**
 * Adjust all cue timings based on pace multiplier.
 */
export function adjustCuesForPace(
    cues: GuidanceCue[],
    paceMultiplier: number
): GuidanceCue[] {
    return cues.map(cue => ({
        ...cue,
        timing: cue.timing * paceMultiplier
    }));
}

// ============================================================================
// STYLE ADJUSTMENT HELPERS
// ============================================================================

/**
 * Apply guidanceStyle post-processing to a cue sequence.
 *
 * This keeps cue planning simple while allowing the same base
 * templates to serve "full", "light", and "silent" experiences.
 */
function applyGuidanceStyle(
    cues: GuidanceCue[],
    activity: ActivityType,
    guidanceStyle: VoiceGuidanceConfig['guidanceStyle']
): GuidanceCue[] {
    if (!guidanceStyle || guidanceStyle === 'full') return cues;

    // For non-mindful activities we keep current behaviour.
    if (activity === 'workout' || activity === 'stretching') {
        return cues;
    }

    // Silent: keep only opening (t=0) + explicit completion cues.
    if (guidanceStyle === 'silent') {
        const hasCompletion = cues.some(c => c.type === 'completion');
        const maxTiming = cues.reduce((m, c) => Math.max(m, c.timing), 0);
        return cues.filter(c =>
            c.timing === 0 ||
            c.type === 'completion' ||
            (!hasCompletion && c.timing === maxTiming) // fallback last cue
        );
    }

    // Light: keep opening, closing, and a sparse set of mid-session prompts.
    if (guidanceStyle === 'light') {
        if (cues.length <= 6) return cues; // already sparse

        const maxTiming = cues.reduce((m, c) => Math.max(m, c.timing), 0);
        const targetSlots = 4; // start, two mid, end
        const slotSize = maxTiming / targetSlots || 1;

        return cues.filter(cue => {
            if (cue.timing === 0 || cue.type === 'completion') return true;
            // Always keep explicit phase-transition style cues
            if (cue.type === 'transition') return true;
            // Prefer immediate (higher-salience) cues over queued ones
            if (cue.priority === 'queued' && (cue.type === 'motivation' || cue.type === 'instruction')) {
                // Sample only some queued cues based on slot buckets
                const bucket = Math.floor(cue.timing / slotSize);
                // Keep first queued cue we encounter in each middle bucket
                return bucket === 1 || bucket === 2;
            }
            return true;
        });
    }

    return cues;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Generate guidance cues for any activity type.
 */
export function generateGuidanceCues(config: VoiceGuidanceConfig): GuidanceCue[] {
    const paceMultiplier = PACE_MULTIPLIERS[config.pace || 'normal'];
    let cues: GuidanceCue[] = [];

    switch (config.activity) {
        case 'workout':
            if (config.exercises && config.exercises.length > 0) {
                cues = generateWorkoutCues(config.exercises, paceMultiplier);
            }
            break;

        case 'breathing': {
            const targetDurationSeconds = config.intervals?.[0]?.work;
            if (config.pattern) {
                cues = generateBreathingCues(config.pattern, paceMultiplier, targetDurationSeconds);
            } else {
                // Default to box breathing
                cues = generateBreathingCues(BREATHING_PATTERNS.box, paceMultiplier, targetDurationSeconds);
            }
            cues = applyGuidanceStyle(cues, 'breathing', config.guidanceStyle);
            break;
        }

        case 'meditation': {
            const duration = config.intervals?.[0]?.work
                ? Math.floor(config.intervals[0].work / 60)
                : 5;
            cues = generateMeditationCues(duration, paceMultiplier);
            cues = applyGuidanceStyle(cues, 'meditation', config.guidanceStyle);
            break;
        }

        case 'stretching':
            // Similar to workout but with longer holds
            if (config.exercises) {
                const stretchExercises = config.exercises.map(e => ({
                    ...e,
                    duration: e.duration || '30s',
                    restAfter: e.restAfter || 10
                }));
                cues = generateWorkoutCues(stretchExercises, paceMultiplier);
            }
            break;

        case 'timer': {
            // Simple timer with end warnings
            const timerDuration = config.intervals?.[0]?.work || 60;
            const timerLabel = (config as any).label || 'Timer';
            cues = generateTimerCues(timerDuration, timerLabel, paceMultiplier);
            cues = applyGuidanceStyle(cues, 'timer', config.guidanceStyle);
            break;
        }
    }

    return cues;
}

/**
 * Get estimated duration for a set of cues.
 */
export function getGuidanceDuration(cues: GuidanceCue[]): number {
    if (cues.length === 0) return 0;
    return Math.max(...cues.map(c => c.timing));
}

/**
 * Get cues that should play at a specific time (with tolerance).
 */
export function getCuesAtTime(
    cues: GuidanceCue[],
    currentTime: number,
    toleranceMs: number = 100
): GuidanceCue[] {
    return cues.filter(cue =>
        Math.abs(cue.timing - currentTime) <= toleranceMs
    );
}
