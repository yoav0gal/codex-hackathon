import type { ComputerCommand } from "../contracts/computer";
import type { DesktopBridge } from "../contracts/ipc";

export async function executeComputerTool(rawArguments: string, bridge: DesktopBridge) {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The desktop tool arguments are invalid.");
    return { ok: true, ...(await bridge.controlComputer(computerCommand(parsed as Record<string, unknown>))) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bob could not control the computer." };
  }
}

export function computerCommand(arguments_: Record<string, unknown>): ComputerCommand {
  const action = requiredAction(arguments_.action);
  const display = optionalInteger(arguments_.display, "display") ?? 0;
  if (action === "see") return { type: "see", display };
  if (action === "type") return { type: "type", text: requiredString(arguments_, "text") };
  if (action === "key") return { type: "key", keys: requiredString(arguments_, "keys") };
  if (action === "click") {
    const button = arguments_.button === "right" ? "right" : "left";
    const count = arguments_.count === 2 ? 2 : 1;
    return { type: "click", display, x: coordinate(arguments_, "x"), y: coordinate(arguments_, "y"), button, count };
  }
  if (action === "drag") {
    return {
      type: "drag", display,
      fromX: coordinate(arguments_, "from_x"), fromY: coordinate(arguments_, "from_y"),
      toX: coordinate(arguments_, "to_x"), toY: coordinate(arguments_, "to_y"),
    };
  }
  return {
    type: "scroll", display, x: coordinate(arguments_, "x"), y: coordinate(arguments_, "y"),
    deltaX: integer(arguments_, "delta_x"), deltaY: integer(arguments_, "delta_y"),
  };
}

function requiredAction(value: unknown) {
  if (value === "see" || value === "click" || value === "drag" || value === "scroll" || value === "type" || value === "key") return value;
  throw new Error("The desktop tool has an invalid action.");
}

function requiredString(arguments_: Record<string, unknown>, name: string) {
  const value = arguments_[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`The desktop tool is missing ${name}.`);
  return value.trim();
}

function coordinate(arguments_: Record<string, unknown>, name: string) {
  const value = integer(arguments_, name);
  if (value < 0 || value > 1_000) throw new Error(`The desktop tool has an invalid ${name}.`);
  return value;
}

function optionalInteger(value: unknown, name: string) {
  if (value === undefined) return undefined;
  const result = integerValue(value, name);
  if (result < 0 || result > 15) throw new Error(`The desktop tool has an invalid ${name}.`);
  return result;
}

function integer(arguments_: Record<string, unknown>, name: string) {
  if (arguments_[name] === undefined) throw new Error(`The desktop tool is missing ${name}.`);
  return integerValue(arguments_[name], name);
}

function integerValue(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`The desktop tool has an invalid ${name}.`);
  return value;
}
