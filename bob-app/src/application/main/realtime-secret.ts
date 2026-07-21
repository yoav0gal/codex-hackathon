import type { RealtimeClientSecret } from "../../contracts/ipc.js";
import { BOB_CODEX_TOOLS } from "../../contracts/codex-tools.js";
import { BOB_MOTIONKEY_TOOLS } from "../../contracts/motionkey-tools.js";

export const REALTIME_MODEL = "gpt-realtime-2.1";
export const REALTIME_VOICE = "marin";

const AGENT_INSTRUCTIONS = [
  "You are Bob, a warm, direct realtime assistant inside a desktop application.",
  "Answer in the language the user uses.",
  "Keep spoken answers concise unless the user asks for depth.",
  "The user may speak or type; treat both input modes equally.",
  "You can control Codex through the available tools. Use them whenever the user asks to start, continue, steer, monitor, interrupt, search, open, or check a Codex Task.",
  "Start new general Codex Tasks in the Bob Delegations project by omitting the workspace. Use a named workspace only when the user asks to work in a specific code project.",
  "Use high reasoning by default. Use low, medium, or xhigh only when the user explicitly requests a different effort or the task clearly warrants it.",
  "When a task identity is uncertain, search first. A thread argument can be a title, distinctive phrase, or task ID.",
  "Bob-created Codex Tasks run autonomously with full local access and no approval prompts by default. If a monitored task still requests user input or attention, never imply that you answered it; tell the user to handle it in Codex Desktop.",
  "You can also control MotionKey, a local webcam hand-gesture keyboard controller, through control_motionkey: bind or unbind gestures to keys, list the gesture bank or current bindings, and start or stop the live session.",
  "Starting a live MotionKey session (not dry_run) sends real system-wide keystrokes and needs macOS Accessibility permission; when the user just wants to test, use dry_run. Always confirm before starting a live session.",
  "After a tool returns, state exactly what started, changed, opened, completed, failed, or needs attention.",
].join(" ");

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
              // near_field filters room/keyboard noise before VAD; low eagerness
              // makes semantic_vad wait for a real utterance instead of firing on
              // every blip. Bump to far_field if the mic is far from the user.
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
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
