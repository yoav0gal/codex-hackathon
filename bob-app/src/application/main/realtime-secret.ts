import type { RealtimeClientSecret } from "../../contracts/ipc.js";
import { BOB_CODEX_TOOLS } from "../../contracts/codex-tools.js";
import { BOB_MOTIONKEY_TOOLS } from "../../contracts/motionkey-tools.js";

export const REALTIME_MODEL = "gpt-realtime-2.1";
export const REALTIME_VOICE = "marin";

const AGENT_INSTRUCTIONS = `
# Role
You are Bob, a warm, direct assistant. Your goal is to help the user control and interact with their computer.
Answer in the user's language and keep spoken responses **super concise**.
Use the available tools to act. After a tool call, clearly say what happened or what needs attention.

# Delegating to Codex
Delegate to Codex when the user asks for a computer action that you cannot perform with a purpose-built tool, or when you do not know how to perform it yourself.
Call start_codex_task with a short, literal, outcome-focused instruction and only the details needed to complete the task. Use low effort unless the task clearly needs more or the user asks for it.
Codex Tasks run in the background. Do not open Codex just because you delegated a task; call open_codex only when the user asks to see it.
Use the other Codex tools to find, continue, monitor, interrupt, open, or check an existing Task. If the target is unclear, search first.
If a Codex Task needs user input, tell the user to handle it in Codex Desktop; never claim you handled it.

# MotionKey
Use control_motionkey to bind or unbind gestures to keys, list gestures or bindings, and start or stop the local webcam hand-gesture keyboard controller.
A live MotionKey session sends real system-wide keystrokes and requires macOS Accessibility permission. Use dry_run for tests, and always confirm before starting a live session.
`.trim();

interface MintSecretOptions {
  apiKey: string | undefined;
  safetyIdentifier: string;
  fetchImpl?: typeof fetch;
}

export async function mintRealtimeClientSecret({
  apiKey,
  safetyIdentifier,
  fetchImpl = fetch,
}: MintSecretOptions): Promise<RealtimeClientSecret> {
  if (!apiKey) {
    throw new Error("OpenAI API key is missing. Add OPENAI_API_KEY to .env.local and restart the app.");
  }

  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          output_modalities: ["audio"],
          instructions: AGENT_INSTRUCTIONS,
          tools: [...BOB_CODEX_TOOLS, ...BOB_MOTIONKEY_TOOLS],
          tool_choice: "auto",
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: REALTIME_VOICE },
          },
        },
      }),
    });
  } catch {
    throw new Error("The app could not reach OpenAI. Check the network and try again.");
  }

  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    throw new Error(`OpenAI rejected the Realtime session (${response.status})${detail}.`);
  }

  const payload = await response.json() as { value?: unknown; expires_at?: unknown };
  if (typeof payload.value !== "string" || typeof payload.expires_at !== "number") {
    throw new Error("OpenAI returned an invalid Realtime client secret.");
  }
  return { value: payload.value };
}

async function safeErrorDetail(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: unknown } };
    const message = typeof payload.error?.message === "string" ? payload.error.message : "";
    return message ? `: ${message.replace(/\bsk-[A-Za-z0-9_-]*/gi, "[redacted]")}` : "";
  } catch {
    return "";
  }
}
