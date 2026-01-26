/**
 * Voice Options Generator
 * 
 * Automatically generates voiceOptions for UI components in Live Mode.
 * This enables hands-free selection through voice commands.
 */

import { SelectionOption, UIComponentData } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface VoicePrompt {
    intro: string;           // "I have 3 options for you..."
    options: string;         // "Option 1: Morning HIIT, Option 2: Evening Yoga..."
    closing: string;         // "Which one would you like?"
    fullPrompt: string;      // Combined prompt
}

// ============================================================================
// MAIN GENERATOR FUNCTION
// ============================================================================

/**
 * Generate voiceOptions for a UI component based on its type and props.
 * Returns null if the component doesn't need voice options.
 */
export function generateVoiceOptions(
    componentType: UIComponentData['type'],
    props: any
): SelectionOption[] | null {
    switch (componentType) {
        case 'workoutList':
            return generateWorkoutListOptions(props);
        case 'workoutBuilder':
            return generateWorkoutBuilderOptions(props);
        case 'goalSelector':
            return generateGoalSelectorOptions(props);
        case 'timer':
            return generateTimerOptions(props);
        default:
            return null;
    }
}

/**
 * Generate a verbal prompt for announcing options in Live Mode.
 */
export function generateVoicePrompt(
    componentType: UIComponentData['type'],
    props: any,
    voiceOptions: SelectionOption[]
): VoicePrompt {
    const count = voiceOptions.length;
    
    switch (componentType) {
        case 'workoutList':
            return generateWorkoutListPrompt(props, voiceOptions);
        case 'workoutBuilder':
            return generateWorkoutBuilderPrompt(props, voiceOptions);
        case 'goalSelector':
            return generateGoalSelectorPrompt(props, voiceOptions);
        case 'timer':
            return generateTimerPrompt(props, voiceOptions);
        default:
            return {
                intro: `I have ${count} options for you.`,
                options: voiceOptions.map((o, i) => `Option ${i + 1}: ${o.label}`).join('. '),
                closing: 'Which one would you like?',
                fullPrompt: ''
            };
    }
}

// ============================================================================
// WORKOUT LIST OPTIONS
// ============================================================================

function generateWorkoutListOptions(props: any): SelectionOption[] {
    const { title, exercises } = props;
    
    if (!exercises || exercises.length === 0) return [];
    
    // Generate options for starting, modifying, or getting more info
    return [
        {
            id: 'start_guided',
            label: `Start ${title || 'workout'} with guidance`,
            index: 0,
            synonyms: ['start', 'begin', 'go', "let's go", 'ready', 'yes', 'start workout', 'guide me'],
            data: { 
                action: 'startGuided',
                title: title || 'Workout',
                exercises: exercises 
            }
        },
        {
            id: 'start_solo',
            label: 'Start without guidance',
            index: 1,
            synonyms: ['solo', 'myself', 'no guidance', 'start solo', 'on my own', 'without help'],
            data: { action: 'startSolo', title, exercises }
        },
        {
            id: 'explain_first',
            label: 'Explain the exercises first',
            index: 2,
            synonyms: ['explain', 'tell me', 'what are', 'describe', 'more info', 'details'],
            data: { action: 'explain' }
        },
        {
            id: 'different_workout',
            label: 'Show me something different',
            index: 3,
            synonyms: ['different', 'another', 'something else', 'change', 'other options'],
            data: { action: 'regenerate' }
        }
    ];
}

function generateWorkoutListPrompt(props: any, options: SelectionOption[]): VoicePrompt {
    const title = props.title || 'workout';
    const exerciseCount = props.exercises?.length || 0;
    const exerciseNames = props.exercises?.slice(0, 3).map((e: any) => e.name).join(', ') || '';
    const hasMore = exerciseCount > 3;
    
    const intro = `I've created a ${title} with ${exerciseCount} exercises${exerciseNames ? `: ${exerciseNames}` : ''}${hasMore ? ' and more' : ''}.`;
    const optionsText = `You can say: "Start" to begin with my guidance, "Solo" to do it yourself, "Explain" for more details, or "Something different" for other options.`;
    const closing = 'What would you like to do?';
    
    return {
        intro,
        options: optionsText,
        closing,
        fullPrompt: `${intro} ${optionsText} ${closing}`
    };
}

// ============================================================================
// WORKOUT BUILDER OPTIONS
// ============================================================================

function generateWorkoutBuilderOptions(props: any): SelectionOption[] {
    const { categories } = props;
    
    if (!categories || categories.length === 0) return [];
    
    // For workout builder, we provide voice options for the first category
    // The AI should guide through each category sequentially
    const firstCategory = categories[0];
    if (!firstCategory?.options) return [];
    
    return firstCategory.options.map((opt: any, index: number) => ({
        id: opt.id,
        label: opt.label,
        index,
        synonyms: generateOptionSynonyms(opt.label, opt.id),
        data: { 
            categoryId: firstCategory.id,
            optionId: opt.id,
            optionLabel: opt.label
        }
    }));
}

function generateWorkoutBuilderPrompt(props: any, options: SelectionOption[]): VoicePrompt {
    const { categories, title, subtitle } = props;
    const firstCategory = categories?.[0];
    
    if (!firstCategory) {
        return {
            intro: "Let's configure your session.",
            options: '',
            closing: 'What type of session would you like?',
            fullPrompt: "Let's configure your session. What type of session would you like?"
        };
    }
    
    const intro = subtitle || "Let's set up your session.";
    const optionsText = options.map((o, i) => `Option ${i + 1}: ${o.label}`).join(', ');
    const closing = `For ${firstCategory.label}, you can choose: ${optionsText}. Which one?`;
    
    return {
        intro,
        options: optionsText,
        closing,
        fullPrompt: `${intro} ${closing}`
    };
}

// ============================================================================
// GOAL SELECTOR OPTIONS
// ============================================================================

function generateGoalSelectorOptions(props: any): SelectionOption[] {
    const { options } = props;
    
    if (!options || options.length === 0) return [];
    
    return options.map((opt: any, index: number) => ({
        id: opt.id,
        label: opt.label,
        index,
        synonyms: generateOptionSynonyms(opt.label, opt.id),
        data: { 
            goalId: opt.id,
            goalLabel: opt.label,
            description: opt.description
        }
    }));
}

function generateGoalSelectorPrompt(props: any, options: SelectionOption[]): VoicePrompt {
    const { selectorTitle, selectorSubtitle } = props;
    const count = options.length;
    
    const intro = selectorSubtitle || `I have ${count} options for you to choose from.`;
    const optionsText = options.map((o, i) => `${i + 1}: ${o.label}`).join(', ');
    const closing = 'Which resonates with you? You can select multiple.';
    
    return {
        intro,
        options: optionsText,
        closing,
        fullPrompt: `${intro} Your options are: ${optionsText}. ${closing}`
    };
}

// ============================================================================
// TIMER OPTIONS
// ============================================================================

function generateTimerOptions(props: any): SelectionOption[] {
    const { label, duration } = props;
    
    return [
        {
            id: 'start_timer',
            label: `Start ${label || 'timer'}`,
            index: 0,
            synonyms: ['start', 'begin', 'go', 'yes', 'ready'],
            data: { action: 'start', label, duration }
        },
        {
            id: 'adjust_duration',
            label: 'Adjust duration',
            index: 1,
            synonyms: ['change time', 'longer', 'shorter', 'different time', 'adjust'],
            data: { action: 'adjust' }
        },
        {
            id: 'cancel_timer',
            label: 'Cancel',
            index: 2,
            synonyms: ['cancel', 'no', 'never mind', 'stop'],
            data: { action: 'cancel' }
        }
    ];
}

function generateTimerPrompt(props: any, options: SelectionOption[]): VoicePrompt {
    const { label, duration } = props;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const durationStr = minutes > 0 
        ? `${minutes} minute${minutes > 1 ? 's' : ''}${seconds > 0 ? ` ${seconds} seconds` : ''}`
        : `${seconds} seconds`;
    
    const intro = `I'm setting up a ${durationStr} ${label || 'timer'}.`;
    const closing = 'Ready to start? Just say "Go" or "Start", or "Adjust" to change the time.';
    
    return {
        intro,
        options: '',
        closing,
        fullPrompt: `${intro} ${closing}`
    };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate common synonyms for an option
 */
function generateOptionSynonyms(label: string, id: string): string[] {
    const synonyms: string[] = [];
    const lower = label.toLowerCase();
    const idLower = id.toLowerCase();
    
    // Add the label and id
    synonyms.push(lower);
    if (idLower !== lower) synonyms.push(idLower);
    
    // Activity type synonyms
    const activitySynonyms: Record<string, string[]> = {
        'strength': ['strength', 'weights', 'lifting', 'muscle', 'resistance'],
        'cardio': ['cardio', 'running', 'aerobic', 'endurance', 'heart'],
        'hiit': ['hiit', 'high intensity', 'intense', 'interval'],
        'yoga': ['yoga', 'stretching', 'flexibility', 'flow'],
        'meditation': ['meditation', 'mindfulness', 'calm', 'peace', 'quiet'],
        'breathing': ['breathing', 'breath', 'breathe', 'breath work'],
        'stretching': ['stretching', 'stretch', 'flexibility', 'limber'],
        'recovery': ['recovery', 'rest', 'restore', 'relax'],
    };
    
    // Check for matches
    for (const [key, syns] of Object.entries(activitySynonyms)) {
        if (lower.includes(key) || idLower.includes(key)) {
            synonyms.push(...syns);
        }
    }
    
    // Duration synonyms
    if (lower.includes('min') || lower.includes('minute')) {
        const num = lower.match(/\d+/);
        if (num) {
            synonyms.push(`${num[0]} minutes`);
            synonyms.push(num[0]);
        }
    }
    
    // Intensity synonyms
    if (lower.includes('easy') || lower.includes('gentle')) {
        synonyms.push('easy', 'gentle', 'light', 'beginner');
    }
    if (lower.includes('medium') || lower.includes('moderate')) {
        synonyms.push('medium', 'moderate', 'intermediate');
    }
    if (lower.includes('hard') || lower.includes('intense') || lower.includes('advanced')) {
        synonyms.push('hard', 'intense', 'advanced', 'challenging');
    }
    
    return [...new Set(synonyms)]; // Remove duplicates
}

/**
 * Enhance a UI component with voice options for Live Mode
 */
export function enhanceWithVoiceOptions(
    componentType: UIComponentData['type'],
    props: any
): { props: any; voiceOptions: SelectionOption[] | undefined; voicePrompt?: VoicePrompt } {
    const voiceOptions = generateVoiceOptions(componentType, props);
    
    if (!voiceOptions || voiceOptions.length === 0) {
        return { props, voiceOptions: undefined };
    }
    
    const voicePrompt = generateVoicePrompt(componentType, props, voiceOptions);
    
    return {
        props: {
            ...props,
            voiceOptions
        },
        voiceOptions,
        voicePrompt
    };
}
