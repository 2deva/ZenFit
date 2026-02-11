/**
 * Vercel serverless API: chat with Gemini. Opik tracing optional (set OPIK_API_KEY to enable).
 * Requires env: GEMINI_API_KEY.
 */

import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { trackGemini } from "opik-gemini";
import { inferIntent, inferUserState } from "./_shared.js";

// Keep this file self-contained for Vercel Functions.
// Root cause fixed: avoid cross-folder imports that Vercel bundling may omit.
const MODEL_CHAT = "gemini-2.5-flash";
const MAX_CLIENT_SYSTEM_INSTRUCTION_CHARS = 16000;
const MAX_HISTORY_MESSAGES = 40;
const SERVER_SYSTEM_INSTRUCTION = [
  "You are Zen, ZenFit's wellness coach.",
  "Prioritize safety, empathy, and practical next steps.",
  "Never provide medical diagnosis, treatment, or emergency alternatives.",
  "If user indicates possible emergency symptoms, advise seeking immediate medical care.",
].join(" ");

const renderUIFunction: FunctionDeclaration = {
  name: "renderUI",
  description:
    "Renders an interactive UI component. WARNING: Do NOT use this for greetings. Only use when specifically needed by the conversation flow.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        description: "The type of UI component to render.",
        enum: [
          "goalSelector",
          "timer",
          "chart",
          "map",
          "dashboard",
          "workoutList",
          "workoutBuilder",
          "streakTimeline",
          "habitHeatmap",
          "achievementBadge",
        ],
      },
      props: { type: Type.OBJECT, description: "Component props JSON." },
    },
    required: ["type", "props"],
  },
};

const calendarFunction: FunctionDeclaration = {
  name: "createCalendarEvent",
  description:
    "Creates an event on the user's Google Calendar. Use this when the user wants to schedule a workout, reminder, or any time-based activity.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'Event title (e.g., "Morning Workout")' },
      scheduledTime: { type: Type.STRING, description: 'ISO 8601 start datetime (e.g., "2026-02-02T16:30:00")' },
      durationMinutes: { type: Type.NUMBER, description: "Duration in minutes (default 30)" },
      description: { type: Type.STRING, description: "Optional event description" },
    },
    required: ["title", "scheduledTime"],
  },
};

const getEventsFunction: FunctionDeclaration = {
  name: "getUpcomingEvents",
  description:
    "Retrieves upcoming events from the user's Google Calendar. Use this when the user asks about their schedule or free time.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxResults: { type: Type.NUMBER, description: "Maximum number of events to return (default 5)" },
    },
  },
};

/** Valid workoutBuilder props: categories array with at least one category, each with at least 2 options (per UI contract). */
function isValidWorkoutBuilderProps(props: any): boolean {
  const cats = props?.categories;
  if (!Array.isArray(cats) || cats.length === 0) return false;
  return cats.every(
    (c: any) =>
      c && typeof c === "object" && Array.isArray(c.options) && c.options.length >= 2
  );
}

/** Valid workoutList props: exercises array with at least one item that has a string name. */
function isValidWorkoutListProps(props: any): boolean {
  const ex = props?.exercises;
  if (!Array.isArray(ex) || ex.length === 0) return false;
  return ex.some((e: any) => e != null && typeof e.name === "string");
}

/** Default workoutList props when model returns invalid/empty so the UI never crashes. */
function getDefaultWorkoutListProps(): { title: string; exercises: { name: string; duration: string }[] } {
  return {
    title: "Quick stretch",
    exercises: [{ name: "Gentle stretch", duration: "5 min" }],
  };
}

/** Default workoutBuilder props when model returns invalid/empty so the user always gets a usable builder. */
function getDefaultWorkoutBuilderProps(): { categories: any[] } {
  return {
    categories: [
      {
        id: "focus",
        label: "Focus",
        options: [
          { id: "mobility", label: "Mobility / Stretch", icon: "activity" },
          { id: "stretch", label: "Stretch", icon: "wind" },
          { id: "strength", label: "Strength", icon: "dumbbell" },
          { id: "cardio", label: "Cardio", icon: "activity" },
        ],
      },
      {
        id: "duration",
        label: "Duration",
        options: [
          { id: "5", label: "5 min" },
          { id: "10", label: "10 min" },
          { id: "15", label: "15 min" },
          { id: "20", label: "20 min" },
        ],
      },
      {
        id: "level",
        label: "Level",
        options: [
          { id: "beginner", label: "Beginner" },
          { id: "intermediate", label: "Intermediate" },
          { id: "advanced", label: "Advanced" },
        ],
      },
    ],
  };
}

async function runChatWithClient(
  client: { models: { generateContent: (opts: any) => Promise<any> } },
  history: Array<{ role: "user" | "model"; text: string }>,
  text: string,
  systemInstruction: string
): Promise<{ text?: string; uiComponent?: any; groundingChunks?: unknown[]; functionCalls?: { name: string; args: any }[] }> {
  const contents = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: "user", parts: [{ text }] });

  const response = await client.models.generateContent({
    model: MODEL_CHAT,
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: [renderUIFunction, calendarFunction, getEventsFunction] }],
    },
  });

  const candidate = response.candidates?.[0];
  const modelParts = candidate?.content?.parts || [];

  let responseText = "";
  const functionCalls: { name: string; args: any }[] = [];
  let uiComponent: any | undefined;

  for (const part of modelParts) {
    if (part.text) responseText += part.text;
    if (part.functionCall) {
      const fc = part.functionCall;
      if (fc.name === "renderUI") {
        const args = fc.args as any;
        if (args?.type && args?.props) {
          let props = args.props;
          if (args.type === "workoutBuilder" && !isValidWorkoutBuilderProps(props)) {
            props = getDefaultWorkoutBuilderProps();
          }
          uiComponent = { type: args.type, props };
        }
      } else {
        functionCalls.push({ name: fc.name, args: fc.args as any });
      }
    }
  }

  // When user explicitly asks for workout builder but model didn't return one, inject default so gen UI always shows.
  const wantsWorkoutBuilder = /workout\s*builder|setup\s*stretches|design\s*(a\s*)?session|show\s*(me\s*)?(a\s*)?workout\s*builder/i.test(text);
  if (wantsWorkoutBuilder && !uiComponent) {
    uiComponent = { type: "workoutBuilder", props: getDefaultWorkoutBuilderProps() };
  }

  // workoutList: ensure exercises array has at least one item with a valid name so the UI never throws.
  if (uiComponent?.type === "workoutList" && uiComponent.props && typeof uiComponent.props === "object") {
    if (!isValidWorkoutListProps(uiComponent.props)) {
      uiComponent = {
        ...uiComponent,
        props: { ...(uiComponent.props as object), ...getDefaultWorkoutListProps() },
      };
    }
  }

  // Timer: ensure duration in SECONDS matches what the model stated in text (e.g. "5-minute" → 300, not 60).
  if (uiComponent?.type === "timer" && uiComponent.props && typeof uiComponent.props === "object") {
    const statedMinutes = (responseText || "").match(/(\d+)\s*min(ute)?s?\b/i)?.[1];
    const minutes = statedMinutes ? parseInt(statedMinutes, 10) : null;
    if (minutes != null && minutes >= 1 && minutes <= 60) {
      const expectedSeconds = minutes * 60;
      const current = (uiComponent.props as any).duration;
      if (typeof current !== "number" || current <= 0 || current !== expectedSeconds) {
        uiComponent = {
          ...uiComponent,
          props: { ...(uiComponent.props as object), duration: expectedSeconds },
        };
      }
    }
  }

  const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
  const hasRenderableContent =
    !!responseText.trim() ||
    !!uiComponent ||
    functionCalls.length > 0 ||
    (groundingChunks as any[]).length > 0;

  // Final server-side guard: never return an empty assistant payload.
  if (!hasRenderableContent) {
    responseText = "I'm here with you. Could you try that one more time?";
  }

  return { text: responseText, uiComponent, groundingChunks: groundingChunks as any[], functionCalls };
}

function sanitizeClientInstruction(raw: string): string {
  if (!raw) return "";
  return raw
    .slice(0, MAX_CLIENT_SYSTEM_INSTRUCTION_CHARS)
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(system|developer)\s*:/gim, "")
    .trim();
}

export const config = { maxDuration: 60 };

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (o: unknown) => unknown } }
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const opikKey = process.env.OPIK_API_KEY;
  const opikProject = process.env.OPIK_PROJECT_NAME || "zenfit";

  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set" });
  }

  let body: { messages?: { role: string; text: string }[]; newMessage?: string; systemInstruction?: string };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { messages = [], newMessage = "", systemInstruction = "" } = body;
  if (!newMessage) {
    return res.status(400).json({ error: "Body must include newMessage" });
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const intent = inferIntent(newMessage);
    const userState = inferUserState(newMessage);
    const tags = ["zenfit", "gemini", `intent:${intent}`, `state:${userState}`, "mode:text"];
    const client = opikKey
      ? trackGemini(genAI, {
        projectName: opikProject,
        traceMetadata: {
          tags,
          component: "zenfit-app",
        },
        generationName: "Zenfit",
      })
      : genAI;

    const history = messages.slice(-MAX_HISTORY_MESSAGES).map((m: { role: string; text: string }) => ({
      role: m.role as "user" | "model",
      text: m.text,
    }));

    const clientContext = sanitizeClientInstruction(systemInstruction);
    const mergedSystemInstruction = clientContext
      ? `${SERVER_SYSTEM_INSTRUCTION}\n\n[CLIENT_CONTEXT]\n${clientContext}`
      : SERVER_SYSTEM_INSTRUCTION;
    const result = await runChatWithClient(client, history as any, newMessage, mergedSystemInstruction);

    if (opikKey && typeof (client as any).flush === "function") {
      try {
        await (client as any).flush();
      } catch (flushErr) {
        console.warn("Opik flush failed (trace not sent):", flushErr);
      }
    }

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(result);
  } catch (err) {
    console.error("api/opik/chat error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Chat failed",
      text: "I'm focusing my energy on connecting to the server. Can you try that again?",
    });
  }
}
