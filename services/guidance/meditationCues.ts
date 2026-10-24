import type { Exercise, GuidanceCue, BreathingPattern } from './types';

export function generateMeditationCues(
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
