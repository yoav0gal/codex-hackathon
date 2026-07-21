import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../contracts/ipc";
import { chromeCommand, executeChromeTool } from "./chrome-tool-router";

describe("Bob Chrome tool routing", () => {
  it("maps Chrome actions into intent-level commands", () => {
    expect(chromeCommand("control_chrome", { action: "open", url: "https://example.com" }))
      .toEqual({ type: "open", url: "https://example.com" });
    expect(chromeCommand("control_chrome", { action: "activate_tab", tab_index: 3 }))
      .toEqual({ type: "activateTab", index: 3 });
    expect(chromeCommand("control_chrome", { action: "close_tab" })).toEqual({ type: "closeTab" });
  });

  it("rejects unsafe or unsupported commands", () => {
    expect(() => chromeCommand("control_chrome", { action: "navigate", url: "" })).toThrow();
    expect(() => chromeCommand("control_chrome", { action: "activate_tab", tab_index: 0 })).toThrow();
    expect(() => chromeCommand("other_tool", { action: "open" })).toThrow();
  });

  it("returns Chrome failures as tool data", async () => {
    const bridge = { controlChrome: vi.fn().mockRejectedValue(new Error("Automation permission denied")) } as unknown as DesktopBridge;
    await expect(executeChromeTool("control_chrome", JSON.stringify({ action: "reload" }), bridge))
      .resolves.toEqual({ ok: false, error: "Automation permission denied" });
  });
});
