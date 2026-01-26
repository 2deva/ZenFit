
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { API_KEY, MODEL_CHAT, MODEL_FAST, SYSTEM_INSTRUCTION } from "../constants";
import { Message, MessageRole, UIComponentData, UserProfile, FitnessStats } from "../types";

const ai = new GoogleGenAI({ apiKey: API_KEY });

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
          exercises: {
            type: Type.ARRAY,
            description: 'List of activities - can be physical exercises, breathing, meditation, etc. Include restAfter for recovery periods between exercises.',
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: 'Exercise name' },
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
          duration: { type: Type.NUMBER, description: 'Duration of the timer IN SECONDS. Convert minutes to seconds (e.g., 10 minutes = 600).' },

          // Chart Props
          chartTitle: { type: Type.STRING },
          dataKey: { type: Type.STRING },
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
      // Must have data points
      if (!Array.isArray(props.data) || props.data.length === 0) {
        console.warn(`GeminiService: chart validation failed - no data array or empty`);
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

export const sendMessageToGemini = async (history: Message[], text: string, context?: UserContext): Promise<Partial<Message>> => {
  try {
    // Inject context into the system instruction or as a preamble
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
        systemContext += `\n\n[REAL-TIME FITNESS DATA DETECTED]
Steps Today: ${context.fitnessStats.steps} / ${context.fitnessStats.stepsGoal}
Calories Burned: ${context.fitnessStats.calories}
Active Minutes: ${context.fitnessStats.activeMinutes}
Health Data Source: ${context.fitnessStats.steps > 0 ? 'Connected' : 'Unavailable'}
INSTRUCTION: Use this data to populate the 'dashboard' component if asked.`;
      }

      // Auth context
      if (context.isAuthenticated && context.userName) {
        systemContext += `\n\n[USER IDENTITY]
User Name: ${context.userName}
Status: Authenticated
INSTRUCTION: Address user by name when appropriate. They have cross-session memory enabled.`;
      } else {
        systemContext += `\n\n[USER IDENTITY]
Status: Guest (Not signed in)
INSTRUCTION: Subtly encourage sign-in for personalization and progress tracking when relevant.`;
      }

      // Memory context from Supabase (Tier 2 & 3)
      if (context.memoryContext) {
        const mc = context.memoryContext;

        if (mc.goals.length > 0) {
          systemContext += `\n\n[LONG-TERM MEMORY: GOALS]`;
          mc.goals.forEach(g => {
            systemContext += `\n- ${g.label}${g.motivation ? ` (Why: "${g.motivation}")` : ''}`;
          });
        }

        if (mc.streaks.length > 0) {
          systemContext += `\n\n[LONG-TERM MEMORY: STREAKS]`;
          mc.streaks.forEach(s => {
            systemContext += `\n- ${s.habitType}: ${s.currentStreak} days current (Best: ${s.longestStreak} days)`;
          });
          systemContext += `\nINSTRUCTION: Celebrate streaks! If streak is 0 or broken, gently encourage restart.`;
        }

        if (mc.recentWorkouts.length > 0) {
          systemContext += `\n\n[RECENT ACTIVITY]`;
          mc.recentWorkouts.forEach(w => {
            const status = w.completed ? '✓ Completed' : '✗ Incomplete';
            systemContext += `\n- ${w.type || 'Workout'} (${w.daysAgo === 0 ? 'Today' : `${w.daysAgo} days ago`}): ${status}`;
          });
        }

        if (mc.relevantMemories.length > 0) {
          systemContext += `\n\n[SEMANTIC MEMORY: PAST CONTEXT]`;
          mc.relevantMemories.forEach(m => {
            systemContext += `\n- "${m}"`;
          });
          systemContext += `\nINSTRUCTION: Use these past insights to personalize your response.`;
        }

        if (mc.upcomingEvents.length > 0) {
          systemContext += `\n\n[SCHEDULED EVENTS]`;
          mc.upcomingEvents.forEach(e => {
            const eventTime = new Date(e.scheduledAt).toLocaleString();
            systemContext += `\n- ${e.title} at ${eventTime}`;
          });
        }
      }

      // Psychology-first onboarding state injection
      if (context.onboardingState) {
        const os = context.onboardingState;
        systemContext += `\n\n[ONBOARDING STATE - PSYCHOLOGY-FIRST]`;
        systemContext += `\nStage: ${os.stage}`;
        systemContext += `\nProfile Completeness: ${os.profileCompleteness}%`;
        systemContext += `\nPsychological State: ${os.psychologicalState}`;
        systemContext += `\nCan Ask Question Now: ${os.canAskQuestion ? 'YES' : 'NO (respect pacing)'}`;
        systemContext += `\nTotal Interactions: ${os.totalInteractions}`;

        if (os.primaryMotivation) {
          systemContext += `\nPrimary Motivation: ${os.primaryMotivation}`;
        }
        if (os.healthConditions.length > 0) {
          systemContext += `\nHealth Conditions: ${os.healthConditions.join(', ')}`;
        }
        if (os.preferredWorkoutTime) {
          systemContext += `\nPreferred Workout Time: ${os.preferredWorkoutTime}`;
        }

        systemContext += `\n\nINSTRUCTION: Follow PSYCHOLOGY-FIRST ONBOARDING protocols based on the psychologicalState above.`;

        if (os.psychologicalState === 'stressed') {
          systemContext += `\nCRITICAL: User is stressed - offer support ONLY, NO questions!`;
        } else if (os.psychologicalState === 'action_oriented') {
          systemContext += `\nUser is action-oriented - deliver value first, questions only during breaks.`;
        } else if (os.psychologicalState === 'hesitant' && os.totalInteractions < 5) {
          systemContext += `\nUser is hesitant with low interactions - build trust through value, ask nothing yet.`;
        } else if (os.psychologicalState === 'high_engagement' && os.canAskQuestion) {
          systemContext += `\nUser is highly engaged - safe to ask contextual questions.`;
        }
      } else {
        // Fallback for users without onboarding state yet
        if (context.profile && context.profile.goals.length > 0) {
          systemContext += `\n\nUSER STATE: Has defined goals - ${context.profile.goals.join(', ')}`;
        } else {
          systemContext += `\n\nUSER STATE: New user - use action-parallel approach, deliver value first.`;
        }
      }
    }

    // Convert internal message format to Gemini API format
    const contents = history.map(msg => ({
      role: msg.role === MessageRole.USER ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    // Add the new user message
    contents.push({
      role: 'user',
      parts: [{ text: text }]
    });


    // Dynamic Tool Switching Logic (Smart Switch)
    // Gemini 2.5 Flash currently crashes if both Function Calling and Google Search are enabled.
    // We sniff the user's intent to decide which tool to enable.

    const searchKeywords = ['search', 'google', 'find', 'online', 'latest', 'research', 'news', 'lookup'];
    const lowerText = text.toLowerCase();
    const isResearchMode = searchKeywords.some(kw => lowerText.includes(kw));

    let activeTools: any[] = [];

    if (isResearchMode) {
      // Enable Google Search ONLY
      activeTools = [{ googleSearch: {} }];
      // console.log("GeminiService: Research Mode Activated (UI Tools Disabled)");
    } else {
      // Enable UI Tools + Calendar Tools (Default)
      activeTools = [{ functionDeclarations: [renderUIFunction, calendarFunction, getEventsFunction] }];
    }

    const response = await ai.models.generateContent({
      model: MODEL_CHAT,
      contents: contents,
      config: {
        systemInstruction: systemContext,
        // thinkingConfig: { thinkingBudget: 0 }, // Conflict: Thinking Mode is currently incompatible with Tools (renderUI)
        tools: activeTools,
      }
    });

    const candidate = response.candidates?.[0];
    const modelParts = candidate?.content?.parts || [];

    let responseText = "";
    const functionCalls: { name: string; args: any }[] = [];
    let uiComponent: UIComponentData | undefined;

    // Process parts to extract text and function calls
    for (const part of modelParts) {
      if (part.text) {
        responseText += part.text;
      }

      if (part.functionCall) {
        const fc = part.functionCall;
        if (fc.name === 'renderUI') {
          const args = fc.args as any;
          if (args && args.type && args.props) {
            // Validate that required props exist for this component type
            if (validateUIComponent(args.type, args.props)) {
              uiComponent = {
                type: args.type,
                props: args.props
              };
            } else {
              console.warn(`GeminiService: Rejecting invalid UI component '${args.type}' - missing required props`, args.props);
            }
          }
        } else {
          // Collect other function calls (like calendar tools)
          functionCalls.push({
            name: fc.name,
            args: fc.args as any
          });
        }
      }
    }

    // Fallback: Detect if the model output the function call as text (Hallucination check)
    // Pattern: renderUI('type', { ... })
    // We regex match the specific pattern seen in failures: renderUI( 'goalSelector', { ... } )
    const leakMatch = responseText.match(/renderUI\s*\(\s*['"](\w+)['"]\s*,\s*(\{[\s\S]*?\})\s*\)/);

    if (leakMatch && !uiComponent) {
      const type = leakMatch[1];
      let propsStr = leakMatch[2];

      try {
        // Attempt to sanitize pseudo-JSON (single quotes to double quotes)
        // 1. Wrap keys in double quotes: 'key': -> "key":
        propsStr = propsStr.replace(/([{,]\s*)'(\w+)'\s*:/g, '$1"$2":');
        // 2. Wrap string values in double quotes: : 'value' -> : "value"
        propsStr = propsStr.replace(/:\s*'([^']*)'/g, ': "$1"');

        const props = JSON.parse(propsStr);

        // Validate before accepting
        if (validateUIComponent(type, props)) {
          uiComponent = { type: type as any, props };
        } else {
          console.warn(`GeminiService: Rejecting leaked UI call '${type}' - missing required props`);
        }

        // Remove the raw function call text from the user-facing message
        responseText = responseText.replace(leakMatch[0], '');

      } catch (e) {
        console.warn("Attempted to parse leaked UI call but failed:", e);
        // Even if we fail to render, strip the ugly code
        responseText = responseText.replace(leakMatch[0], '');
      }
    }

    // Extract grounding metadata if available
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];

    return {
      text: responseText,
      uiComponent,
      groundingChunks: groundingChunks as any[],
      functionCalls
    };

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return {
      text: "I'm focusing my energy on connecting to the server. Can you try that again?",
    };
  }
};
