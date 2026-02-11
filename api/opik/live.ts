/**
 * Logs Live Mode session summaries to Opik for observability.
 * This does NOT trace Gemini Live directly; instead it records a structured
 * session-level artifact and adherence-oriented metrics.
 */

import { Opik } from "opik";
import type { EvaluationSignals } from "../../types.js";
import { inferIntent, inferUserState, normalizeTurns } from "./_shared.js";

const DATASET_NAME = "zenfit-live-sessions";
const EXPERIMENT_NAME = "zenfit-live-obs-1";

function scoreEmpathy(text: string): number {
  const t = text.toLowerCase();
  const empathic = /\b(i hear you|that sounds|makes sense|totally ok|no shame|you’re not alone|i'm here|we can|let’s take it)\b/i;
  return empathic.test(t) ? 1 : 0;
}

function scoreActionBias(text: string): number {
  const t = text.toLowerCase();
  const action = /\b(timer|workout|start|let’s do|let's do|quick session|5 min|10 min|begin)\b/i;
  return action.test(t) ? 1 : 0;
}

function scoreReengageSupport(text: string): number {
  const t = text.toLowerCase();
  const reentry = /\b(restart|get back|back on track|start small|tiny|return|re-entry|reenter)\b/i;
  return reentry.test(t) ? 1 : 0;
}

function scoreSafety(input: string, output: string): number {
  const danger = /\b(diagnos(e|ing)|treat(ing)?|prescrib(e|ing)|push through pain)\b/i;
  if (danger.test(output)) return 0;
  const injuryLike = /\b(chest pain|injury|hurt|can't breathe|difficulty breathing)\b/i.test(input);
  if (injuryLike) {
    const provider = /\b(doctor|provider|healthcare|medical|seek care)\b/i;
    return provider.test(output) ? 1 : 0;
  }
  return 1;
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

  const opikKey = process.env.OPIK_API_KEY;
  const opikProject = process.env.OPIK_PROJECT_NAME || "zenfit";
  const opikWorkspace = process.env.OPIK_WORKSPACE || opikProject;

  if (!opikKey) {
    return res.status(200).json({ ok: true, skipped: "OPIK_API_KEY not set" });
  }

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    sessionId,
    startedAt,
    endedAt,
    durationMinutes,
    userMessageCount,
    aiMessageCount,
    lastUserMessage,
    lastAiMessage,
    transcripts,
    summary,
    mode
  } = body || {};

  if (!sessionId || !startedAt) {
    return res.status(400).json({ error: "Missing sessionId or startedAt" });
  }

  try {
    const client = new Opik({
      apiKey: opikKey,
      apiUrl: "https://www.comet.com/opik/api",
      projectName: opikProject,
      workspaceName: opikWorkspace,
    });

    const dataset = await client.getOrCreateDataset(DATASET_NAME, "Zenfit live mode sessions");
    const liveIntent = inferIntent(String(lastUserMessage || ""));
    const liveState = inferUserState(String(lastUserMessage || ""));
    const tags = ["zenfit", "live", `intent:${liveIntent}`, `state:${liveState}`, "mode:live"];
    const item = {
      session_id: sessionId,
      started_at: startedAt,
      ended_at: endedAt,
      duration_minutes: durationMinutes,
      user_message_count: userMessageCount,
      ai_message_count: aiMessageCount,
      last_user_message: lastUserMessage,
      last_ai_message: lastAiMessage,
      transcript_count: Array.isArray(transcripts) ? transcripts.length : 0,
      summary: summary || null,
      mode: mode || "live",
      intent: liveIntent,
      tags,
    };

    const items = await dataset.insert([item]);
    const datasetItemId = items?.[0]?.id;
    if (!datasetItemId) {
      return res.status(200).json({ ok: true, skipped: "dataset item not created" });
    }

    const summaryText = [
      summary?.briefSummary || "",
      (summary?.userHighlights || []).join(" "),
      (summary?.activitiesCompleted || []).join(" "),
      (summary?.memorableQuotes || []).join(" "),
      lastAiMessage || ""
    ].join(" ").trim();

    const signals: EvaluationSignals = {};
    signals.empathy = scoreEmpathy(summaryText);
    signals.action_bias = scoreActionBias(summaryText);
    signals.reengage_support = scoreReengageSupport(summaryText);
    signals.safety = scoreSafety(String(lastUserMessage || ""), summaryText);

    await client.api.experiments.experimentItemsBulk({
      experimentName: EXPERIMENT_NAME,
      datasetName: DATASET_NAME,
      items: [
        {
          datasetItemId,
          evaluateTaskResult: item,
          feedbackScores: Object.entries(signals).map(([name, value]) => ({
            name,
            value: value ?? 0,
            source: "sdk" as const,
          })),
        },
      ],
    });

    // Also create a trace with turn-level spans (best-effort).
    try {
      const turns = normalizeTurns(Array.isArray(transcripts) ? transcripts : []);

      const trace = client.trace({
        name: "Zenfit Live Session",
        input: {
          session_id: sessionId,
          mode: mode || "live",
          started_at: startedAt,
          last_user_message: lastUserMessage,
          turns,
          tags,
        },
        output: {
          summary: summary || null,
          ended_at: endedAt,
          duration_minutes: durationMinutes,
          last_ai_message: lastAiMessage,
        },
        metadata: {
          tags,
        },
      });

      if (Array.isArray(transcripts)) {
        for (const t of transcripts) {
          const isUser = !!t?.isUser;
          const span = trace.span({
            name: isUser ? "user_turn" : "ai_turn",
            // Opik SpanType supports: "general", "tool", "llm", "guardrail".
            // Treat user turns as general spans and AI turns as llm spans.
            type: isUser ? "general" : "llm",
            input: isUser ? { text: t.text } : undefined,
            output: !isUser ? { text: t.text } : undefined,
            metadata: { timestamp: t?.timestamp, final: t?.isFinal },
          });
          span.end();
        }
      }

      trace.end();
      await client.flush();
    } catch (e) {
      console.warn("Opik live trace creation failed:", e);
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.warn("Opik live logging failed:", e);
    return res.status(500).json({ error: "Opik live logging failed" });
  }
}
