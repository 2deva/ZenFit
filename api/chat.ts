/**
 * Vercel serverless API: chat with Gemini. Opik tracing optional (set OPIK_API_KEY to enable).
 * Requires env: GEMINI_API_KEY.
 */

import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { trackGemini } from "opik-gemini";

// Keep this file self-contained for Vercel Functions.
// Root cause fixed: avoid cross-folder imports that Vercel bundling may omit.
const MODEL_CHAT = "gemini-2.5-flash";

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
        if (args?.type && args?.props) uiComponent = { type: args.type, props: args.props };
      } else {
        functionCalls.push({ name: fc.name, args: fc.args as any });
      }
    }
  }

  const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
  return { text: responseText, uiComponent, groundingChunks: groundingChunks as any[], functionCalls };
}

export const config = { maxDuration: 60 };

export default async function handler(req: { method?: string; body?: unknown }, res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (o: unknown) => unknown } }) {
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
  if (!newMessage || !systemInstruction) {
    return res.status(400).json({ error: "Body must include newMessage and systemInstruction" });
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const client = opikKey
      ? trackGemini(genAI, {
          projectName: opikProject,
          traceMetadata: { tags: ["zenfit", "gemini"], component: "zenfit-app" },
          generationName: "Zenfit",
        })
      : genAI;

    const history = messages.map((m: { role: string; text: string }) => ({
      role: m.role as "user" | "model",
      text: m.text,
    }));

    const result = await runChatWithClient(client, history as any, newMessage, systemInstruction);

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
    console.error("api/chat error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Chat failed",
      text: "I'm focusing my energy on connecting to the server. Can you try that again?",
    });
  }
}
