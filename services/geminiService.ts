
import { Type, FunctionDeclaration } from "@google/genai";
import { MODEL_CHAT, MODEL_FAST, SYSTEM_INSTRUCTION } from "../constants";
import { Message, MessageRole, UIComponentData, UserProfile, FitnessStats, LifeContext } from "../types";
import { getSupportedExerciseNames } from "./exerciseGifService";
import { ai } from "./opikGemini";

export const renderUIFunction: FunctionDeclaration = {
  name: 'renderUI',
  description: 'Renders an interactive UI component. WARNING: Do NOT use this for greetings. Only use when specifically needed by the conversation flow.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        description: 'The type of UI component to render.',
        enum: ['goalSelector', 'timer', 'chart', 'map', 'dashboard', 'workoutList', 'workoutBuilder', 'streakTimeline', 'habitHeatmap', 'achievementBadge']
      },
      props: {
        type: Type.OBJECT,
        description: 'JSON object containing properties for the component.',
        properties: {
          // Goal Selector Props (Dynamic)
          options: {
            type: Type.ARRAY,
            description: 'A list of 3-6 selectable goal options tailored to the user conversation.',
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: 'Unique ID (e.g. "weight-loss")' },
                label: { type: Type.STRING, description: 'Display Label (e.g. "Weight Loss")' },
                description: { type: Type.STRING, description: 'Subtitle (e.g. "Burn calories")' },
                icon: {
                  type: Type.STRING,
                  description: 'Icon key',
                  enum: ['fire', 'bolt', 'heart', 'footprints', 'brain', 'trophy', 'leaf', 'timer', 'moon', 'sun', 'sparkles', 'wind']
                }
              },
              required: ['icon']
            }
          },
          // GoalSelector heading props
          selectorTitle: { type: Type.STRING, description: 'Title for goalSelector (e.g., "Your Focus", "What Matters Today")' },
          selectorSubtitle: { type: Type.STRING, description: 'Subtitle for goalSelector (e.g., "Choose what resonates")' },

          // Dashboard Props
          dailyProgress: { type: Type.NUMBER, description: 'Percentage 0-100' },
          caloriesBurned: { type: Type.NUMBER },
          stepsTaken: { type: Type.NUMBER },
          stepsGoal: { type: Type.NUMBER },
          activeMinutes: { type: Type.NUMBER },

          // WorkoutList Props (supports exercises AND mental activities)
          title: { type: Type.STRING },
          rounds: { type: Type.NUMBER, description: 'Number of rounds to repeat the exercise list (default 1). If the workout has multiple rounds, set this to > 1.' },
          exercises: {
            type: Type.ARRAY,
            description: 'List of activities - can be physical exercises, breathing, meditation, etc. Include restAfter for recovery periods between exercises.',
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: 'Exercise name. For physical exercises, MUST be one of the names from the [AVAILABLE EXERCISE DATABASE] provided in context.' },
                reps: { type: Type.STRING, description: 'Number of repetitions (e.g., "10 reps", "8 reps per leg")' },
                duration: { type: Type.STRING, description: 'Duration for time-based exercises (e.g., "30 seconds", "1 minute")' },
                restAfter: { type: Type.NUMBER, description: 'Rest period in seconds after this exercise (e.g., 30 for 30 seconds rest). Include this for proper recovery pacing.' }
              }
            }
          },

          // SessionBuilder Props (fully dynamic categories)
          subtitle: { type: Type.STRING, description: 'Subtitle for the builder (e.g., "Customize your experience")' },
          submitLabel: { type: Type.STRING, description: 'Button text (e.g., "Begin Session" or "Generate Workout")' },
          categories: {
            type: Type.ARRAY,
            description: 'Dynamic categories for session configuration. Each category has options.',
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: 'Category ID (e.g., "focus", "duration", "level")' },
                label: { type: Type.STRING, description: 'Display label (e.g., "Focus", "Duration")' },
                type: { type: Type.STRING, enum: ['icons', 'pills', 'buttons'], description: 'Display type' },
                default: { type: Type.STRING, description: 'Default selected option ID' },
                options: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      label: { type: Type.STRING },
                      icon: { type: Type.STRING, enum: ['dumbbell', 'activity', 'flame', 'brain', 'leaf', 'heart', 'moon', 'sun', 'wind', 'sparkles', 'timer'] }
                    }
                  }
                }
              }
            }
          },

          // Map Props
          locationName: { type: Type.STRING },
          address: { type: Type.STRING },
          query: { type: Type.STRING },

          // Timer Props
          label: { type: Type.STRING, description: 'Timer label (e.g., "Box Breathing", "Plank Hold", "Meditation")' },
          duration: { type: Type.NUMBER, description: 'Duration of the timer IN SECONDS. 1 minute = 60, 5 minutes = 300. When user says "1 min" or "one minute" use 60.' },

          // Chart Props
          chartTitle: { type: Type.STRING },
          dataKey: { type: Type.STRING },
          emptyMessage: { type: Type.STRING, description: 'Shown when data is empty (e.g. "No sessions yet — your first one will show here")' },
          data: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                value: { type: Type.NUMBER },
              }
            }
          },
        }
      }
    },
    required: ['type', 'props']
  },
};

// Calendar function for scheduling events via Gemini
export const calendarFunction: FunctionDeclaration = {
  name: 'createCalendarEvent',
  description: 'Creates an event on the user\'s Google Calendar. Use this when the user wants to schedule a workout, reminder, or any time-based activity.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Event title (e.g., "Morning Workout", "Yoga Session")'
      },
      scheduledTime: {
        type: Type.STRING,
        description: 'ISO 8601 datetime for when the event starts (e.g., "2025-01-22T09:00:00")'
      },
      durationMinutes: {
        type: Type.NUMBER,
        description: 'Duration of the event in minutes (default 30)'
      },
      description: {
        type: Type.STRING,
        description: 'Optional event description'
      }
    },
    required: ['title', 'scheduledTime']
  }
};

// Get upcoming events from calendar
export const getEventsFunction: FunctionDeclaration = {
  name: 'getUpcomingEvents',
  description: 'Retrieves upcoming events from the user\'s Google Calendar. Use this when the user asks about their schedule or free time.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxResults: {
        type: Type.NUMBER,
        description: 'Maximum number of events to return (default 5)'
      }
    }
  }
};

// ============================================================================
// VOICE-SPECIFIC ACTIVITY TOOLS
// ============================================================================

// Start a guided activity with voice cues (for Live Mode)
export const startGuidedActivityFunction: FunctionDeclaration = {
  name: 'startGuidedActivity',
  description: 'Initiates a guided activity with voice cues. Use this during Live Mode when the user wants to start a workout, breathing exercise, or meditation with real-time guidance.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      activityType: {
        type: Type.STRING,
        description: 'Type of guided activity',
        enum: ['workout', 'breathing', 'meditation', 'stretching']
      },
      exercises: {
        type: Type.ARRAY,
        description: 'For workout/stretching: list of exercises with name, reps/duration, and rest',
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Exercise name (e.g., "Push-ups")' },
            reps: { type: Type.STRING, description: 'Number of reps (e.g., "10") or omit for duration-based' },
            duration: { type: Type.STRING, description: 'Duration (e.g., "30s", "1 minute") for holds/planks' },
            restAfter: { type: Type.NUMBER, description: 'Seconds of rest after this exercise (default 30)' }
          }
        }
      },
      breathingPattern: {
        type: Type.STRING,
        description: 'For breathing: preset pattern name',
        enum: ['box', 'relaxing', 'energizing', 'calming', 'focus']
      },
      durationMinutes: {
        type: Type.NUMBER,
        description: 'For meditation: duration in minutes (default 5)'
      },
      pace: {
        type: Type.STRING,
        description: 'Initial pace for guidance cues',
        enum: ['slow', 'normal', 'fast']
      }
    },
    required: ['activityType']
  }
};

// Control an ongoing guided activity (for Live Mode)
export const controlActivityFunction: FunctionDeclaration = {
  name: 'controlActivity',
  description: 'Controls an ongoing guided activity during Live Mode. Use when user wants to pause, resume, skip exercises, or adjust pace.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'Control action to perform',
        enum: ['pause', 'resume', 'skip', 'back', 'stop', 'slower', 'faster', 'repeat']
      },
      targetExercise: {
        type: Type.STRING,
        description: 'For skip/back: optionally specify which exercise to go to'
      }
    },
    required: ['action']
  }
};

// Provide voice feedback during activity (for Live Mode)
export const voiceFeedbackFunction: FunctionDeclaration = {
  name: 'provideVoiceFeedback',
  description: 'Provides motivational or instructional feedback during an activity. Use to encourage user, offer form tips, or acknowledge achievements.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      feedbackType: {
        type: Type.STRING,
        description: 'Type of feedback to provide',
        enum: ['motivation', 'form_tip', 'progress_update', 'achievement', 'encouragement']
      },
      message: {
        type: Type.STRING,
        description: 'The feedback message to speak (keep concise for voice)'
      },
      priority: {
        type: Type.STRING,
        description: 'Whether to speak immediately or queue',
        enum: ['immediate', 'queued']
      }
    },
    required: ['feedbackType', 'message']
  }
};

export interface UserContext {
  location?: { lat: number; lng: number };
  time: string;
  date: string;
  timezone?: string;
  timezoneOffset?: number;
  profile?: UserProfile;
  fitnessStats?: FitnessStats;
  // Auth context
  isAuthenticated?: boolean;
  userName?: string;
  // Memory context from Supabase
  memoryContext?: {
    goals: { type: string; label: string; motivation: string | null }[];
    streaks: { habitType: string; currentStreak: number; longestStreak: number }[];
    recentWorkouts: { type: string | null; completed: boolean; daysAgo: number }[];
    relevantMemories: string[];
    upcomingEvents: { title: string; scheduledAt: string }[];
  };
  // Psychology-first onboarding state
  onboardingState?: {
    stage: 'initial' | 'goals_set' | 'motivation_known' | 'preferences_inferred' | 'complete';
    profileCompleteness: number;
    psychologicalState: 'high_engagement' | 'action_oriented' | 'hesitant' | 'stressed' | 'unknown';
    canAskQuestion: boolean;
    primaryMotivation?: string;
    healthConditions: string[];
    preferredWorkoutTime?: string;
    totalInteractions: number;
  };
  // Context awareness
  minutesSinceLastMessage?: number;
  // Activity state tracking
  activeTimer?: {
    label: string;
    totalSeconds: number;
    remainingSeconds: number;
    isRunning: boolean;
    startedAt: number;
  };
  currentWorkoutProgress?: {
    title: string;
    totalExercises: number;
    completedCount: number;
    completedExercises: string[];
    remainingExercises: string[];
    startedAt: number;
    minutesSinceStarted: number;
  };
  lastGeneratedWorkout?: {
    title: string;
    exerciseCount: number;
    generatedAt: number;
    minutesAgo: number;
  };
  recentUIInteractions?: {
    type: string;
    timestamp: number;
    minutesAgo: number;
  }[];
  // Holistic life context (goals, schedule, movement, psychology)
  lifeContext?: LifeContext;
}

/**
 * Validates that a UI component has all required props before rendering.
 * Prevents empty state rendering when Gemini returns incomplete data.
 * Exported for use in both text and voice mode tool handling.
 */
export const validateUIComponent = (type: string, props: any): boolean => {
  if (!props) {
    console.warn(`GeminiService: UI validation failed - props is null/undefined for type '${type}'`);
    return false;
  }

  // console.log(`GeminiService: Validating UI component '${type}' with props:`, JSON.stringify(props, null, 2));

  switch (type) {
    case 'workoutBuilder': {
      // Must have at least 1 category with at least 1 option each
      const cats = props.categories;
      if (!Array.isArray(cats) || cats.length === 0) {
        console.warn(`GeminiService: workoutBuilder validation failed - no categories array or empty`);
        return false;
      }
      const allHaveOptions = cats.every((cat: any) => {
        if (!cat || typeof cat !== 'object') return false;
        if (!Array.isArray(cat.options) || cat.options.length === 0) {
          console.warn(`GeminiService: workoutBuilder validation failed - category '${cat.id || 'unknown'}' has no options`);
          return false;
        }
        return true;
      });
      if (!allHaveOptions) return false;
      // console.log(`GeminiService: workoutBuilder validation PASSED with ${cats.length} categories`);
      return true;
    }
    case 'timer':
      // Must have positive duration
      if (typeof props.duration !== 'number' || props.duration <= 0) {
        console.warn(`GeminiService: timer validation failed - invalid duration: ${props.duration}`);
        return false;
      }
      return true;
    case 'workoutList':
      // Must have at least 1 exercise
      if (!Array.isArray(props.exercises) || props.exercises.length === 0) {
        console.warn(`GeminiService: workoutList validation failed - no exercises array or empty`);
        return false;
      }
      return true;
    case 'chart':
      // Allow empty data for empty state (ChartWidget shows emptyMessage)
      if (!Array.isArray(props.data)) {
        console.warn(`GeminiService: chart validation failed - data must be an array`);
        return false;
      }
      return true;
    case 'goalSelector':
      // GoalSelector has built-in fallback, always valid
      return true;
    case 'dashboard':
      // Dashboard always shows something
      return true;
    case 'map':
      // Map needs a query or location
      if (!(props.query || props.locationName || props.address)) {
        console.warn(`GeminiService: map validation failed - no query/locationName/address`);
        return false;
      }
      return true;
    case 'streakTimeline':
    case 'habitHeatmap':
    case 'achievementBadge':
      // These are info displays, always valid if props exist
      return true;
    default:
      return true;
  }
};

const classifyUserIntent = async (text: string): Promise<'SEARCH' | 'APP'> => {
  try {
    const result = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: [{
        role: 'user',
        parts: [{ text: `Classify the following user message into one of two categories: 'SEARCH' (if it requires looking up external real-time information, news, or general knowledge) or 'APP' (if it refers to using the app, workouts, goals, timers, or general chat). Return ONLY the word SEARCH or APP.\n\nMessage: "${text}"` }]
      }],
      config: { responseMimeType: 'text/plain' }
    });
    const category = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || 'APP';
    return category.includes('SEARCH') ? 'SEARCH' : 'APP';
  } catch (e) {
    console.warn("Intent classification failed, defaulting to APP", e);
    return 'APP';
  }
};

/**
 * Build system instruction string from context. Exported so client can send it to /api/chat for Opik tracing.
 */
export async function buildSystemInstruction(context?: UserContext): Promise<string> {
  let systemContext = SYSTEM_INSTRUCTION;
  if (context) {
    systemContext += `\n\n=== CURRENT CONTEXT ===\nDate: ${context.date}\nTime: ${context.time}`;
    if (context.timezone) {
      systemContext += `\nTimezone: ${context.timezone} (UTC Offset: ${context.timezoneOffset} min)`;
    }
    if (context.location) {
      systemContext += `\nUser Location Lat/Lng: ${context.location.lat}, ${context.location.lng}`;
    }
    if (context.fitnessStats) {
      const sourceLabel = context.fitnessStats.connectionStatus === 'disconnected'
        ? 'Disconnected — reconnect to see real data'
        : context.fitnessStats.dataSource === 'google_fit'
          ? 'Connected'
          : context.fitnessStats.steps > 0 ? 'Connected' : 'Unavailable';
      systemContext += `\n\n[REAL-TIME FITNESS DATA DETECTED]
Steps Today: ${context.fitnessStats.steps} / ${context.fitnessStats.stepsGoal}
Calories Burned: ${context.fitnessStats.calories}
Active Minutes: ${context.fitnessStats.activeMinutes}
Health Data Source: ${sourceLabel}
INSTRUCTION: Use this data to populate the 'dashboard' component if asked.`;
    }
    if (context.isAuthenticated && context.userName) {
      systemContext += `\n\n[USER IDENTITY]\nUser Name: ${context.userName}\nStatus: Authenticated\nINSTRUCTION: Address user by name when appropriate. They have cross-session memory enabled.`;
    } else {
      systemContext += `\n\n[USER IDENTITY]\nStatus: Guest (Not signed in)\nINSTRUCTION: Subtly encourage sign-in for personalization and progress tracking when relevant.`;
    }
    if (context.memoryContext) {
      const mc = context.memoryContext;
      if (mc.goals.length > 0) {
        systemContext += `\n\n[LONG-TERM MEMORY: GOALS]`;
        mc.goals.forEach(g => { systemContext += `\n- ${g.label}${g.motivation ? ` (Why: "${g.motivation}")` : ''}`; });
      }
      if (mc.streaks.length > 0) {
        systemContext += `\n\n[LONG-TERM MEMORY: STREAKS]`;
        mc.streaks.forEach(s => {
          systemContext += `\n- ${s.habitType}: ${s.currentStreak} days current (Best: ${s.longestStreak} days)`;
          if (s.currentStreak === 7 || s.currentStreak === 14 || s.currentStreak === 30) systemContext += ` ⭐ MILESTONE - Consider showing achievementBadge!`;
        });
        systemContext += `\nINSTRUCTION: Celebrate streaks! Show streakTimeline after workouts. If streak is 0 or broken, gently encourage restart.`;
        systemContext += `\nTOOL USAGE: When user asks about progress or after workout completion, use streakTimeline with habitName="${mc.streaks[0].habitType}", currentStreak=${mc.streaks[0].currentStreak}, longestStreak=${mc.streaks[0].longestStreak}`;
      }
      if (mc.recentWorkouts.length > 0) {
        const completedCount = mc.recentWorkouts.filter(w => w.completed).length;
        mc.recentWorkouts.forEach(w => {
          const status = w.completed ? '✓ Completed' : '✗ Incomplete';
          systemContext += `\n- ${w.type || 'Workout'} (${w.daysAgo === 0 ? 'Today' : `${w.daysAgo} days ago`}): ${status}`;
        });
        systemContext += `\nTotal Completed: ${completedCount} workouts`;
        systemContext += `\nPROGRESS VISUALIZATION: When user asks about progress ("show my progress", "how am I doing", "progress this week"), always call renderUI with type 'chart' (and optionally streakTimeline/habitHeatmap). If ${completedCount >= 1 ? 'they have data' : 'they have no sessions'}, use chart with real data or with data: [] and emptyMessage: "No sessions yet — your first one will show here".`;
      } else {
        systemContext += `\n\nPROGRESS VISUALIZATION: When user asks about progress ("show my progress", "how am I doing", "progress this week"), always call renderUI with type 'chart', data: [], emptyMessage: "No sessions yet — your first one will show here".`;
      }
      if (mc.relevantMemories.length > 0) {
        systemContext += `\n\n[SEMANTIC MEMORY: PAST CONTEXT]`;
        mc.relevantMemories.forEach(m => { systemContext += `\n- "${m}"`; });
        systemContext += `\nINSTRUCTION: Use these past insights to personalize your response.`;
      }
      if (mc.upcomingEvents.length > 0) {
        systemContext += `\n\n[SCHEDULED EVENTS]`;
        mc.upcomingEvents.forEach(e => { systemContext += `\n- ${e.title} at ${new Date(e.scheduledAt).toLocaleString()}`; });
      }
    }
    if (context.lifeContext) {
      const lc = context.lifeContext;
      systemContext += `\n\n[LIFE CONTEXT SUMMARY]`;
      if (lc.profile.occupation || lc.profile.environment) systemContext += `\nOccupation: ${lc.profile.occupation || 'unknown'}; Environment: ${lc.profile.environment || 'unspecified'}.`;
      if (lc.goals && lc.goals.length > 0) {
        const topGoals = lc.goals.slice(0, 3);
        systemContext += `\nGoals (top ${topGoals.length}):`;
        topGoals.forEach((g, idx) => {
          const streak = g.currentStreak ?? 0, best = g.bestStreak ?? streak, perWeek = g.targetPerWeek ?? '?', doneWeek = g.completionsThisWeek ?? 0;
          systemContext += `\n  ${idx + 1}) ${g.label} – ${g.type}. Streak: ${streak} days (best ${best}). This week: ${doneWeek}/${perWeek}.`;
        });
      }
      if (lc.movementBaseline?.patternSummary) systemContext += `\nMovement baseline: ${lc.movementBaseline.patternSummary}`;
      if (lc.schedule?.preferredTrainingWindows?.length > 0) systemContext += `\nPreferred training windows (coarse): ${lc.schedule.preferredTrainingWindows.map(w => w.label).join(', ')}.`;
      else systemContext += `\nPreferred training windows: not known; ask the user briefly when they prefer to move.`;
      if (lc.psychology) {
        systemContext += `\nPrimary "why": ${lc.psychology.primaryWhy}.`;
        if (lc.psychology.riskPatterns.length > 0) systemContext += `\nRisk patterns: ${lc.psychology.riskPatterns.join(', ')}.`;
        systemContext += `\nTone guardrails: ${lc.psychology.toneGuardrails}`;
      }
      if (lc.suggestedNextAction) systemContext += `\nSuggested next action (use for proactive nudge when appropriate): ${lc.suggestedNextAction}`;
    }
    if (context.onboardingState) {
      const os = context.onboardingState;
      systemContext += `\n\n[ONBOARDING STATE - PSYCHOLOGY-FIRST]`;
      systemContext += `\nStage: ${os.stage}\nProfile Completeness: ${os.profileCompleteness}%\nPsychological State: ${os.psychologicalState}\nCan Ask Question Now: ${os.canAskQuestion ? 'YES' : 'NO (respect pacing)'}\nTotal Interactions: ${os.totalInteractions}`;
      if (os.primaryMotivation) systemContext += `\nPrimary Motivation: ${os.primaryMotivation}`;
      if (os.healthConditions.length > 0) systemContext += `\nHealth Conditions: ${os.healthConditions.join(', ')}`;
      if (os.preferredWorkoutTime) systemContext += `\nPreferred Workout Time: ${os.preferredWorkoutTime}`;
      systemContext += `\n\nINSTRUCTION: Follow PSYCHOLOGY-FIRST ONBOARDING protocols based on the psychologicalState above.`;
      if (os.psychologicalState === 'stressed') systemContext += `\nCRITICAL: User is stressed - offer support ONLY, NO questions!`;
      else if (os.psychologicalState === 'action_oriented') systemContext += `\nUser is action-oriented - deliver value first, questions only during breaks.`;
      else if (os.psychologicalState === 'hesitant' && os.totalInteractions < 5) systemContext += `\nUser is hesitant with low interactions - build trust through value, ask nothing yet.`;
      else if (os.psychologicalState === 'high_engagement' && os.canAskQuestion) systemContext += `\nUser is highly engaged - safe to ask contextual questions.`;
    } else {
      if (context.profile && context.profile.goals.length > 0) systemContext += `\n\nUSER STATE: Has defined goals - ${context.profile.goals.join(', ')}`;
      else systemContext += `\n\nUSER STATE: New user - use action-parallel approach, deliver value first.`;
    }
  }
  try {
    const availableExercises = await getSupportedExerciseNames();
    if (availableExercises.length > 0) {
      systemContext += `\n\n[AVAILABLE EXERCISE DATABASE]\nThe following is the COMPLETE LIST of supported physical exercises.\nWhen generating a workout with physical exercises, you MUST strictly choose names from this list to ensure we can show a demonstration GIF.\nIf the user asks for an exercise not on this list, map it to the closest match from this list.\n\n${availableExercises.join(', ')}\n\nINSTRUCTION: Use ONLY these names for physical exercises in 'workoutList' or 'startGuidedActivity'.`;
    }
  } catch (e) {
    console.warn("Failed to inject exercise database", e);
  }
  return systemContext;
}

/**
 * Run chat with a given Gemini client (raw or Opik-tracked). Used by sendMessageToGemini and by /api/chat for tracing.
 */
export async function runChatWithClient(
  client: { models: { generateContent: (opts: any) => Promise<any> } },
  history: Message[],
  text: string,
  systemContext: string
): Promise<Partial<Message>> {
  const contents = history.map(msg => ({
    role: msg.role === MessageRole.USER ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));
  contents.push({ role: 'user', parts: [{ text }] });
  const searchKeywords = ['search', 'google', 'find', 'online', 'latest', 'research', 'news', 'lookup'];
  const isResearchMode = searchKeywords.some(kw => text.toLowerCase().includes(kw));
  const activeTools = isResearchMode ? [{ googleSearch: {} }] : [{ functionDeclarations: [renderUIFunction, calendarFunction, getEventsFunction] }];
  const response = await client.models.generateContent({
    model: MODEL_CHAT,
    contents,
    config: { systemInstruction: systemContext, tools: activeTools }
  });
  const candidate = response.candidates?.[0];
  const modelParts = candidate?.content?.parts || [];
  let responseText = "";
  const functionCalls: { name: string; args: any }[] = [];
  let uiComponent: UIComponentData | undefined;
  for (const part of modelParts) {
    // Only use text and functionCall; ignore thoughtSignature and other opaque fields.
    if (part.text) responseText += part.text;
    if (part.functionCall) {
      const fc = part.functionCall;
      if (fc.name === 'renderUI') {
        const args = fc.args as any;
        if (args?.type && args?.props && validateUIComponent(args.type, args.props)) uiComponent = { type: args.type, props: args.props };
        else if (args?.type) console.warn(`GeminiService: Rejecting invalid UI component '${args.type}' - missing required props`, args.props);
      } else functionCalls.push({ name: fc.name, args: fc.args as any });
    }
  }
  const leakMatch = responseText.match(/renderUI\s*\(\s*['"](\w+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/);
  if (leakMatch && !uiComponent) {
    try {
      let propsStr = leakMatch[2].replace(/([{,]\s*)'(\w+)'\s*:/g, '$1"$2":').replace(/:\s*'([^']*)'/g, ': "$1"');
      const props = JSON.parse(propsStr);
      if (validateUIComponent(leakMatch[1], props)) uiComponent = { type: leakMatch[1] as any, props };
      responseText = responseText.replace(leakMatch[0], '');
    } catch { responseText = responseText.replace(leakMatch[0], ''); }
  }
  const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
  return { text: responseText, uiComponent, groundingChunks: groundingChunks as any[], functionCalls };
}

export const sendMessageToGemini = async (history: Message[], text: string, context?: UserContext): Promise<Partial<Message>> => {
  try {
    const systemContext = await buildSystemInstruction(context);
    return runChatWithClient(ai, history, text, systemContext);
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return { text: "I'm focusing my energy on connecting to the server. Can you try that again?" };
  }
};

