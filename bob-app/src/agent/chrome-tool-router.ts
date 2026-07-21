import type { ChromeCommand } from "../contracts/chrome";
import type { DesktopBridge } from "../contracts/ipc";

export async function executeChromeTool(name: string, rawArguments: string, bridge: DesktopBridge) {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The Chrome tool arguments are invalid.");
    return { ok: true, ...(await bridge.controlChrome(chromeCommand(name, parsed as Record<string, unknown>)) ) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bob could not control Google Chrome." };
  }
}

export function chromeCommand(name: string, arguments_: Record<string, unknown>): ChromeCommand {
  if (name !== "control_chrome") throw new Error(`Bob does not support the Chrome tool “${name}”.`);
  switch (requiredString(arguments_, "action")) {
    case "open": return optionalUrl(arguments_) ? { type: "open", url: optionalUrl(arguments_) } : { type: "open" };
    case "navigate": return { type: "navigate", url: requiredUrl(arguments_) };
    case "new_tab": return optionalUrl(arguments_) ? { type: "newTab", url: optionalUrl(arguments_) } : { type: "newTab" };
    case "list_tabs": return { type: "listTabs" };
    case "activate_tab": return { type: "activateTab", index: requiredTabIndex(arguments_) };
    case "close_tab": return optionalTabIndex(arguments_) ? { type: "closeTab", index: optionalTabIndex(arguments_) } : { type: "closeTab" };
    case "back": return { type: "back" };
    case "forward": return { type: "forward" };
    case "reload": return { type: "reload" };
    default: throw new Error("The Chrome action is not supported.");
  }
}

function requiredString(arguments_: Record<string, unknown>, field: string) {
  const value = arguments_[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`The Chrome ${field} is required.`);
  return value.trim();
}

function optionalUrl(arguments_: Record<string, unknown>) {
  const value = arguments_.url;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 8_192) throw new Error("The Chrome URL is invalid.");
  return value.trim();
}

function requiredUrl(arguments_: Record<string, unknown>) {
  const url = optionalUrl(arguments_);
  if (!url) throw new Error("The Chrome URL is required.");
  return url;
}

function optionalTabIndex(arguments_: Record<string, unknown>) {
  const value = arguments_.tab_index;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error("The Chrome tab index is invalid.");
  }
  return value;
}

function requiredTabIndex(arguments_: Record<string, unknown>) {
  const index = optionalTabIndex(arguments_);
  if (!index) throw new Error("The Chrome tab index is required.");
  return index;
}
