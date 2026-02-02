/**
 * Local API server for Opik tracing and Google Calendar endpoints on localhost.
 * Run: npm run dev:api (from project root)
 * Then run npm run dev and open http://localhost:5173 — Vite proxies /api to this server.
 */
import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { GoogleGenAI } from "@google/genai";
import { trackGemini } from "opik-gemini";
import { runChatWithClient } from "../services/geminiService.js";
import oauthStartHandler from "../api/google/oauth/start.js";
import oauthCallbackHandler from "../api/google/oauth/callback.js";
import calendarEventsHandler from "../api/google/calendar/events.js";

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

// Adapter to convert Node.js http request/response to Vercel-style handlers
async function callVercelHandler(
  handler: (req: any, res: any) => Promise<void>,
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse
): Promise<void> {
  const url = new URL(nodeReq.url || "/", `http://${nodeReq.headers.host || "localhost"}`);
  
  // Read body for POST/PUT requests before creating req object
  let bodyData: any = undefined;
  if (nodeReq.method === "POST" || nodeReq.method === "PUT") {
    let body = "";
    for await (const chunk of nodeReq) body += chunk;
    try {
      bodyData = JSON.parse(body || "{}");
    } catch {
      bodyData = {};
    }
  }

  const req: any = {
    method: nodeReq.method,
    url: nodeReq.url,
    headers: nodeReq.headers,
    query: Object.fromEntries(url.searchParams),
    body: bodyData,
  };

  const res: any = {
    status: (code: number) => {
      nodeRes.statusCode = code;
      return res;
    },
    json: (data: any) => {
      nodeRes.setHeader("Content-Type", "application/json");
      nodeRes.end(JSON.stringify(data));
    },
    send: (data: string) => {
      nodeRes.end(data);
    },
    writeHead: (status: number, headers?: Record<string, string>) => {
      nodeRes.statusCode = status;
      if (headers) {
        Object.entries(headers).forEach(([k, v]) => nodeRes.setHeader(k, v));
      }
      return res;
    },
    setHeader: (name: string, value: string) => {
      nodeRes.setHeader(name, value);
    },
    end: (data?: string) => {
      nodeRes.end(data);
    },
  };

  await handler(req, res);
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = req.url || "/";
  const urlPath = url.split("?")[0]; // Remove query string for exact matching

  // Debug logging
  console.log(`[dev-api-server] ${req.method} ${url}`);

  // Health check endpoint
  if (urlPath === "/api/health" || urlPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "dev-api-server" }));
    return;
  }

  // Route to appropriate handler
  if (urlPath === "/api/chat" && req.method === "POST") {
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
  } else if (urlPath === "/api/google/oauth/start" && req.method === "POST") {
    await callVercelHandler(oauthStartHandler, req, res);
  } else if (urlPath.startsWith("/api/google/oauth/callback") && req.method === "GET") {
    await callVercelHandler(oauthCallbackHandler, req, res);
  } else if (urlPath.startsWith("/api/google/calendar/events")) {
    await callVercelHandler(calendarEventsHandler, req, res);
  } else {
    console.warn(`[dev-api-server] 404: ${req.method} ${url}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path: url }));
  }
});

server.listen(PORT, () => {
  console.log(`Local API server: http://localhost:${PORT}`);
  console.log(`  - /api/chat (POST)`);
  console.log(`  - /api/google/oauth/start (POST)`);
  console.log(`  - /api/google/oauth/callback (GET)`);
  console.log(`  - /api/google/calendar/events (GET, POST)`);
});
