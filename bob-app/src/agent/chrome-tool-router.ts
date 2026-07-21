import type { ChromeCommand } from "../contracts/chrome";
import type { DesktopBridge } from "../contracts/ipc";

export async function executeChromeTool(rawArguments: string, bridge: DesktopBridge) {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The Google Chrome tool arguments are invalid.");
    }
    return { ok: true, ...(await bridge.controlChrome(chromeCommand(parsed as Record<string, unknown>)) ) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Bob could not control Google Chrome.",
    };
  }
}

export function chromeCommand(arguments_: Record<string, unknown>): ChromeCommand {
  const action = arguments_.action;
  if (action !== "open" && action !== "navigate" && action !== "new_tab") {
    throw new Error("The Google Chrome tool has an invalid action.");
  }
  const url = optionalString(arguments_, "url");
  if ((action === "navigate" || action === "new_tab") && !url) {
    throw new Error("The Google Chrome tool is missing url.");
  }
  return action === "new_tab"
    ? { type: "newTab", url: url! }
    : action === "navigate"
      ? { type: "navigate", url: url! }
      : { type: "open", ...(url ? { url } : {}) };
}

function optionalString(arguments_: Record<string, unknown>, name: string) {
  const value = arguments_[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`The Google Chrome tool has an invalid ${name}.`);
  return value.trim() || undefined;
}
