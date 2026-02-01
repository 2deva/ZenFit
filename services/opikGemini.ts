/**
 * Shared Gemini client. All LLM calls use this client.
 *
 * Opik tracing: opik-gemini requires Node.js (see https://www.comet.com/docs/opik/integrations/gemini-typescript).
 * This app is a browser SPA, so we use the raw client only. No opik-gemini in the bundle = no stub, no runtime errors.
 * To enable tracing: run the same code in Node (e.g. server/API route) and wrap with trackGemini(genAI) there.
 * Env for future Node use: OPIK_API_KEY, OPIK_PROJECT_NAME (default: zenfit).
 */

import { GoogleGenAI } from "@google/genai";
import { API_KEY } from "../constants";

export const ai = new GoogleGenAI({ apiKey: API_KEY });

/** No-op in browser; when using Opik in Node, call trackedGenAI.flush() before exit. */
export async function flushOpik(): Promise<void> {
  if (typeof (ai as any).flush === "function") await (ai as any).flush();
}
