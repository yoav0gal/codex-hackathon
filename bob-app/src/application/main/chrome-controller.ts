import { spawn } from "node:child_process";
import type { ChromeCommand, ChromeResult, ChromeTab } from "../../contracts/chrome.js";

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 24_000;
const separator = "\u001f";

/** Controls Chrome through macOS Apple Events, keeping untrusted values in argv. */
export class ChromeController {
  async execute(command: ChromeCommand): Promise<ChromeResult> {
    switch (command.type) {
      case "open":
        await this.run(command.url ? script.openUrl : script.open, command.url ? [command.url] : []);
        return { output: command.url ? "Opened Google Chrome and navigated to the requested page." : "Opened Google Chrome." };
      case "navigate":
        await this.run(script.navigate, [command.url]);
        return { output: "Navigated the active Chrome tab." };
      case "newTab":
        await this.run(script.newTab, command.url ? [command.url] : []);
        return { output: "Opened a new Chrome tab." };
      case "listTabs": {
        const tabs = parseTabs(await this.run(script.listTabs));
        return { output: tabs.length ? `Found ${tabs.length} Chrome tab${tabs.length === 1 ? "" : "s"}.` : "Google Chrome has no open tabs.", tabs };
      }
      case "activateTab":
        await this.run(script.activateTab, [String(command.index)]);
        return { output: `Activated Chrome tab ${command.index}.` };
      case "closeTab":
        await this.run(script.closeTab, command.index ? [String(command.index)] : []);
        return { output: command.index ? `Closed Chrome tab ${command.index}.` : "Closed the active Chrome tab." };
      case "back": await this.run(script.back); return { output: "Went back in Chrome." };
      case "forward": await this.run(script.forward); return { output: "Went forward in Chrome." };
      case "reload": await this.run(script.reload); return { output: "Reloaded the active Chrome tab." };
    }
  }

  private run(source: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/osascript", ["-e", source, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const append = (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString("utf8"); };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Google Chrome did not respond in time.")); }, TIMEOUT_MS);
      child.on("error", (error) => { clearTimeout(timer); reject(new Error(`Could not control Google Chrome: ${error.message}`)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        const text = output.trim().slice(0, MAX_OUTPUT);
        if (code === 0) resolve(text);
        else reject(new Error(text || "Google Chrome could not complete that action. Allow Bob to automate Google Chrome in macOS when prompted."));
      });
    });
  }
}

function parseTabs(output: string): ChromeTab[] {
  if (!output) return [];
  return output.split("\n").flatMap((line) => {
    const [index, active, title, url] = line.split(separator);
    const tabIndex = Number(index);
    return Number.isInteger(tabIndex) && title !== undefined && url !== undefined
      ? [{ index: tabIndex, active: active === "true", title, url }]
      : [];
  });
}

const script = {
  open: 'tell application "Google Chrome" to activate',
  openUrl: 'on run argv\n tell application "Google Chrome"\n  activate\n  if (count of windows) = 0 then make new window\n  set URL of active tab of front window to item 1 of argv\n end tell\nend run',
  navigate: 'on run argv\n tell application "Google Chrome"\n  activate\n  if (count of windows) = 0 then make new window\n  set URL of active tab of front window to item 1 of argv\n end tell\nend run',
  newTab: 'on run argv\n tell application "Google Chrome"\n  activate\n  if (count of windows) = 0 then make new window\n  if (count of argv) = 0 then\n   make new tab at end of tabs of front window\n  else\n   make new tab at end of tabs of front window with properties {URL:item 1 of argv}\n  end if\n end tell\nend run',
  listTabs: `tell application "Google Chrome"\n set resultText to ""\n set tabIndex to 0\n repeat with windowItem in windows\n  repeat with tabItem in tabs of windowItem\n   set tabIndex to tabIndex + 1\n   set activeFlag to (active tab of windowItem is tabItem)\n   set resultText to resultText & tabIndex & "${separator}" & activeFlag & "${separator}" & (title of tabItem) & "${separator}" & (URL of tabItem) & linefeed\n  end repeat\n end repeat\n return resultText\nend tell`,
  activateTab: 'on run argv\n set wanted to (item 1 of argv) as integer\n tell application "Google Chrome"\n  activate\n  set tabIndex to 0\n  repeat with windowItem in windows\n   repeat with tabItem in tabs of windowItem\n    set tabIndex to tabIndex + 1\n    if tabIndex = wanted then\n     set active tab index of windowItem to (index of tabItem)\n     set index of windowItem to 1\n     return\n    end if\n   end repeat\n  end repeat\n  error "Chrome tab not found."\n end tell\nend run',
  closeTab: 'on run argv\n tell application "Google Chrome"\n  if (count of windows) = 0 then error "Google Chrome has no open tabs."\n  if (count of argv) = 0 then\n   close active tab of front window\n   return\n  end if\n  set wanted to (item 1 of argv) as integer\n  set tabIndex to 0\n  repeat with windowItem in windows\n   repeat with tabItem in tabs of windowItem\n    set tabIndex to tabIndex + 1\n    if tabIndex = wanted then\n     close tabItem\n     return\n    end if\n   end repeat\n  end repeat\n  error "Chrome tab not found."\n end tell\nend run',
  back: 'tell application "Google Chrome" to go back active tab of front window',
  forward: 'tell application "Google Chrome" to go forward active tab of front window',
  reload: 'tell application "Google Chrome" to reload active tab of front window',
};
