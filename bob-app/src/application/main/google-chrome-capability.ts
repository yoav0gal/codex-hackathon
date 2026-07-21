import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChromeCommand, ChromeCommandValue } from "../../contracts/chrome.js";

const executeFile = promisify(execFile);

/** Controls the user's installed Google Chrome through macOS's Chrome scripting API. */
export class GoogleChromeCapability {
  async execute(command: ChromeCommand): Promise<ChromeCommandValue> {
    if (process.platform !== "darwin") {
      throw new Error("Google Chrome control is currently available on macOS only.");
    }

    await executeFile("osascript", ["-e", chromeScript, command.type, command.url ?? ""]);
    return {
      action: command.type === "newTab" ? "newTab" : command.type === "navigate" ? "navigated" : "opened",
      ...(command.url ? { url: command.url } : {}),
    };
  }
}

const chromeScript = `on run argv
  set actionName to item 1 of argv
  set targetUrl to item 2 of argv

  tell application "Google Chrome"
    activate
    if (count of windows) is 0 then make new window

    if actionName is "navigate" then
      set URL of active tab of front window to targetUrl
    else if actionName is "newTab" then
      tell front window to make new tab with properties {URL:targetUrl}
    else if targetUrl is not "" then
      set URL of active tab of front window to targetUrl
    end if
  end tell
end run`;
