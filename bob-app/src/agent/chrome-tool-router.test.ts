import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../contracts/ipc";
import { chromeCommand, executeChromeTool } from "./chrome-tool-router";

describe("Google Chrome tool routing", () => {
  it("maps Realtime actions onto Chrome commands", () => {
    expect(chromeCommand({ action: "open" })).toEqual({ type: "open" });
    expect(chromeCommand({ action: "navigate", url: "https://example.com" })).toEqual({
      type: "navigate",
      url: "https://example.com",
    });
    expect(chromeCommand({ action: "new_tab", url: "https://example.com/docs" })).toEqual({
      type: "newTab",
      url: "https://example.com/docs",
    });
  });

  it("requires a URL for navigation actions", () => {
    expect(() => chromeCommand({ action: "navigate" })).toThrow("missing url");
  });

  it("returns Chrome failures as tool data", async () => {
    const bridge = {
      controlChrome: vi.fn().mockRejectedValue(new Error("Google Chrome is not installed")),
    } as unknown as DesktopBridge;

    await expect(executeChromeTool(JSON.stringify({ action: "open" }), bridge)).resolves.toEqual({
      ok: false,
      error: "Google Chrome is not installed",
    });
  });
});
