/**
 * Local API server for Opik tracing and Google Calendar endpoints on localhost.
 * Run: npm run dev:api (from project root)
 * Then run npm run dev and open http://localhost:5173 — Vite proxies /api to this server.
 */
import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import oauthStartHandler from "../api/google/oauth/start.js";
import oauthCallbackHandler from "../api/google/oauth/callback.js";
import calendarEventsHandler from "../api/google/calendar/events.js";
import opikLiveHandler from "../api/opik/live.js";
import opikChatHandler from "../api/opik/chat.js";

const PORT = 3001;

// Adapter to convert Node.js http request/response to Vercel-style handlers
async function callVercelHandler(
  handler: (req: any, res: any) => Promise<unknown> | Promise<void>,
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
  if (urlPath === "/api/google/oauth/start" && req.method === "POST") {
    await callVercelHandler(oauthStartHandler, req, res);
  } else if (urlPath.startsWith("/api/google/oauth/callback") && req.method === "GET") {
    await callVercelHandler(oauthCallbackHandler, req, res);
  } else if (urlPath.startsWith("/api/google/calendar/events")) {
    await callVercelHandler(calendarEventsHandler, req, res);
  } else if (urlPath === "/api/opik/chat" && req.method === "POST") {
    await callVercelHandler(opikChatHandler, req, res);
  } else if (urlPath === "/api/opik/live" && req.method === "POST") {
    await callVercelHandler(opikLiveHandler, req, res);
  } else {
    console.warn(`[dev-api-server] 404: ${req.method} ${url}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path: url }));
  }
});

server.listen(PORT, () => {
  console.log(`Local API server: http://localhost:${PORT}`);
  console.log(`  - /api/google/oauth/start (POST)`);
  console.log(`  - /api/google/oauth/callback (GET)`);
  console.log(`  - /api/google/calendar/events (GET, POST)`);
  console.log(`  - /api/opik/chat (POST)`);
  console.log(`  - /api/opik/live (POST)`);
});
