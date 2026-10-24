import type { Exercise, GuidanceCue, BreathingPattern } from './types';
import { getExerciseFormInstruction, getExerciseCoaching, getRandomMotivation } from './coaching';
import { parseGuidanceDuration as parseDuration } from './duration';

export function generateWorkoutCues(
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
