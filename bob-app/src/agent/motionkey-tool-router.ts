import type { MotionKeyCommand, MotionKeyGestureMode } from "../contracts/motionkey";
import type { DesktopBridge } from "../contracts/ipc";

export async function executeMotionKeyTool(name: string, rawArguments: string, bridge: DesktopBridge) {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The MotionKey tool arguments are invalid.");
    }
    const command = motionKeyCommand(name, parsed as Record<string, unknown>);
    return { ok: true, ...(await bridge.controlMotionKey(command)) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Bob could not control MotionKey.",
    };
  }
}

export function motionKeyCommand(name: string, arguments_: Record<string, unknown>): MotionKeyCommand {
  if (name !== "control_motionkey") {
    throw new Error(`Bob does not support the MotionKey tool “${name}”.`);
  }
  const action = stringValue(arguments_, "action");
  switch (action) {
    case "bind":
      return {
        type: "bind",
        gesture: requiredString(arguments_, "gesture"),
        key: requiredString(arguments_, "key"),
        mode: mode(arguments_),
      };
    case "unbind":
      return { type: "unbind", gesture: requiredString(arguments_, "gesture") };
    case "list_bindings":
      return { type: "listBindings" };
    case "list_gestures":
      return { type: "listGestures" };
    case "start":
      return {
        type: "start",
        dryRun: boolean(arguments_, "dry_run"),
        preview: boolean(arguments_, "preview"),
      };
    case "stop":
      return { type: "stop" };
    case "status":
      return { type: "status" };
    default:
      throw new Error(`The MotionKey action “${action}” is not supported.`);
  }
}

function mode(arguments_: Record<string, unknown>): MotionKeyGestureMode {
  const value = arguments_.mode;
  if (value === undefined) return "hold";
  if (value !== "hold" && value !== "tap") throw new Error("The MotionKey mode is invalid.");
  return value;
}

function boolean(arguments_: Record<string, unknown>, name: string): boolean {
  const value = arguments_[name];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`The MotionKey ${name} is invalid.`);
  return value;
}

function requiredString(arguments_: Record<string, unknown>, name: string) {
  const value = arguments_[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`The MotionKey tool is missing ${name}.`);
  return value.trim();
}

function stringValue(arguments_: Record<string, unknown>, name: string) {
  const value = arguments_[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`The MotionKey tool is missing ${name}.`);
  return value.trim();
}
