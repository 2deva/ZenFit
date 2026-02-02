/**
 * Local API server for Opik tracing on localhost.
 * Run: npm run dev:api (from project root)
 * Then run npm run dev and open http://localhost:5173 — Vite proxies /api to this server.
 */
import "dotenv/config";
import { createServer } from "http";
import { GoogleGenAI } from "@google/genai";
import { trackGemini } from "opik-gemini";
import { runChatWithClient } from "../services/geminiService.js";

const PORT = 3001;

async function handleChat(body: {
  messages?: { role: string; text: string }[];
  newMessage?: string;
  systemInstruction?: string;
}) {
  const { messages = [], newMessage = "", systemInstruction = "" } = body;
  if (!newMessage || !systemInstruction) {
    return { status: 400, json: { error: "Body must include newMessage and systemInstruction" } };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const opikKey = process.env.OPIK_API_KEY;
  const opikProject = process.env.OPIK_PROJECT_NAME || "zenfit";

  if (!apiKey) return { status: 500, json: { error: "GEMINI_API_KEY not set" } };

  const genAI = new GoogleGenAI({ apiKey });
  const client = opikKey
    ? trackGemini(genAI, {
        projectName: opikProject,
        traceMetadata: { tags: ["zenfit", "gemini"], component: "zenfit-app" },
        generationName: "Zenfit",
      })
    : genAI;

  const history = (messages as { role: string; text: string }[]).map((m) => ({
    role: m.role as "user" | "model",
    text: m.text,
    id: "",
    timestamp: 0,
  }));

  const result = await runChatWithClient(client, history as any, newMessage, systemInstruction);

  if (opikKey && typeof (client as any).flush === "function") {
    try {
      await (client as any).flush();
    } catch (flushErr) {
      console.warn("Opik flush failed (trace not sent):", flushErr);
    }
  }

  return { status: 200, json: result };
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  try {
    const { status, json } = await handleChat(parsed as any);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  } catch (err) {
    console.error("dev-api-server error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Chat failed",
        text: "I'm focusing my energy on connecting to the server. Can you try that again?",
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(`Opik API server: http://localhost:${PORT}/api/chat`);
});
