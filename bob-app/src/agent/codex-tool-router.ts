import type { CodexCommand, CodexEffort } from "../contracts/codex";
import type { DesktopBridge } from "../contracts/ipc";

export async function executeCodexTool(name: string, rawArguments: string, bridge: DesktopBridge) {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The Codex tool arguments are invalid.");
    }
    const command = codexCommand(name, parsed as Record<string, unknown>);
    return { ok: true, ...(await bridge.controlCodex(command)) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Bob could not control Codex.",
    };
  }
}

export function codexCommand(name: string, arguments_: Record<string, unknown>): CodexCommand {
  if (name === "start_codex_task") {
    return {
      type: "start",
      task: requiredString(arguments_, "task"),
      effort: effort(arguments_),
      ...(optionalString(arguments_, "workspace") ? { workspace: optionalString(arguments_, "workspace") } : {}),
    };
  }
  if (name === "continue_codex_task") {
    return {
      type: "continue",
      instruction: requiredString(arguments_, "instruction"),
      effort: effort(arguments_),
      ...(optionalString(arguments_, "thread") ? { thread: optionalString(arguments_, "thread") } : {}),
    };
  }
  if (name === "monitor_codex_task") {
    return { type: "monitor", thread: requiredString(arguments_, "thread") };
  }
  if (name === "interrupt_codex_task" || name === "get_codex_task_status") {
    const type = name === "interrupt_codex_task" ? "interrupt" : "status";
    const thread = optionalString(arguments_, "thread");
    return { type, ...(thread ? { thread } : {}) };
  }
  if (name === "open_codex") {
    return {
      type: "open",
      target: openTarget(arguments_),
      ...(optionalString(arguments_, "reference") ? { reference: optionalString(arguments_, "reference") } : {}),
    };
  }
  if (name === "search_codex") {
    return { type: "search", scope: searchScope(arguments_), query: stringValue(arguments_, "query") };
  }
  throw new Error(`Bob does not support the Codex tool “${name}”.`);
}

function openTarget(arguments_: Record<string, unknown>) {
  const value = arguments_.target;
  if (value !== "app" && value !== "delegations" && value !== "project" && value !== "thread") {
    throw new Error("The Codex tool has an invalid open target.");
  }
  return value;
}

function searchScope(arguments_: Record<string, unknown>) {
  const value = arguments_.scope;
  if (value !== "projects" && value !== "threads" && value !== "all") {
    throw new Error("The Codex tool has an invalid search scope.");
  }
  return value;
}

function effort(arguments_: Record<string, unknown>): CodexEffort {
  const value = arguments_.effort;
  if (value === undefined) return "high";
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "xhigh") {
    throw new Error("The Codex tool has an invalid effort.");
  }
  return value;
}

function requiredString(arguments_: Record<string, unknown>, name: string) {
  const value = optionalString(arguments_, name);
  if (!value) throw new Error(`The Codex tool is missing ${name}.`);
  return value;
}

function optionalString(arguments_: Record<string, unknown>, name: string) {
  const value = arguments_[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`The Codex tool has an invalid ${name}.`);
  return value.trim() || undefined;
}

function stringValue(arguments_: Record<string, unknown>, name: string) {
  const value = arguments_[name];
  if (typeof value !== "string") throw new Error(`The Codex tool is missing ${name}.`);
  return value.trim();
}
