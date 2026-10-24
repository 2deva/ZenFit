import type { ActivityType } from './types';

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

export function getExerciseFormInstruction(exerciseName: string): string {
    const nameLower = exerciseName.toLowerCase();
    for (const [key, instruction] of Object.entries(EXERCISE_FORM_INSTRUCTIONS)) {
        if (nameLower.includes(key)) {
            return instruction;
        }
    }
    return EXERCISE_FORM_INSTRUCTIONS.default;
}

export function getExerciseCoaching(exerciseName: string): string {
    const nameLower = exerciseName.toLowerCase();
    for (const [key, phrases] of Object.entries(EXERCISE_COACHING)) {
        if (nameLower.includes(key)) {
            return phrases[Math.floor(Math.random() * phrases.length)];
        }
    }
    return EXERCISE_COACHING.default[Math.floor(Math.random() * EXERCISE_COACHING.default.length)];
}

export function getRandomMotivation(activity: ActivityType): string {
    const phrases = MOTIVATIONAL_PHRASES[activity] || MOTIVATIONAL_PHRASES.workout;
    return phrases[Math.floor(Math.random() * phrases.length)];
}

