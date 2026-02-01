/**
 * Vercel serverless API: chat with Gemini and send traces to Opik (Node-only SDK).
 * Requires env: GEMINI_API_KEY, OPIK_API_KEY, OPIK_PROJECT_NAME (e.g. zenfit).
 */

import { GoogleGenAI } from "@google/genai";
import { trackGemini } from "opik-gemini";
import { runChatWithClient } from "../services/geminiService";

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
  if (!opikKey) {
    return res.status(500).json({ error: "OPIK_API_KEY not set (required for /api/chat)" });
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
    const tracked = trackGemini(genAI, {
      projectName: opikProject,
      traceMetadata: { tags: ["zenfit", "gemini"], component: "zenfit-app" },
      generationName: "Zenfit",
    });

    const history = messages.map((m: { role: string; text: string }) => ({
      role: m.role as "user" | "model",
      text: m.text,
      id: "",
      timestamp: 0,
    }));

    const result = await runChatWithClient(tracked, history as any, newMessage, systemInstruction);
    await (tracked as any).flush?.();

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
