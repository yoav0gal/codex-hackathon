import type { RealtimeClientSecret } from "../../contracts/ipc.js";
import { BOB_CODEX_TOOLS } from "../../contracts/codex-tools.js";

export const REALTIME_MODEL = "gpt-realtime-2.1";
export const REALTIME_VOICE = "marin";

const AGENT_INSTRUCTIONS = [
  "You are Bob, a warm, direct realtime assistant inside a desktop application.",
  "Answer in the language the user uses.",
  "Keep spoken answers concise unless the user asks for depth.",
  "The user may speak or type; treat both input modes equally.",
  "Use a purpose-built tool when one is available for the user's request.",
  "When no available tool can perform the requested action, or you do not know how to perform it with the available tools, use start_codex_task to delegate the action instead of stopping at an explanation or asking the user how to do it.",
  "Keep fallback task prompts short, literal, and outcome-focused. Include only the user's requested action and necessary target details. For example, if the user asks you to open Chrome but you have no Chrome tool, start a Codex Task with: Open Chrome, look for <what the user requested>, and bring Chrome to the front of the computer.",
  "You can control Codex through the available tools. Use them whenever the user asks to start, continue, steer, monitor, interrupt, search, open, or check a Codex Task.",
  "Start new general Codex Tasks in the Bob Delegations project by omitting the workspace. Use a named workspace only when the user asks to work in a specific code project.",
  "Use low reasoning for Codex Tasks by default. Use medium, high, or xhigh only when the user explicitly requests a different effort or the task clearly warrants it.",
  "When a project or task identity is uncertain, call search_codex first. Search can inspect configured projects, recent Codex Tasks, or both.",
  "Codex Tasks start, continue, and run in the background. Never call open_codex merely because you started, continued, or monitored a Task.",
  "Call open_codex only when the user explicitly asks to open, show, or bring Codex Desktop to the foreground. A request to bring another application, such as Chrome, to the foreground belongs in the delegated task and is not a request to open Codex.",
  "Use open_codex to foreground the current Codex view, the Bob Delegations project, a named code project, or an existing Task. A project reference may be its directory name or absolute path; a thread reference may be a title, distinctive phrase, or Task ID.",
  "Bob-created Codex Tasks run autonomously with full local access and no approval prompts by default. If a monitored task still requests user input or attention, never imply that you answered it; tell the user to handle it in Codex Desktop.",
  "After a tool returns, state exactly what started, changed, opened, completed, failed, or needs attention. Describe a newly started or continued Task as running in the background.",
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
          tools: BOB_CODEX_TOOLS,
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
