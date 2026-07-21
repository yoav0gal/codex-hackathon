import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../contracts/ipc";
import { codexCommand, executeCodexTool } from "./codex-tool-router";

describe("Bob Codex tool routing", () => {
  it("maps a start tool onto one intent-level Codex command", () => {
    expect(codexCommand("start_codex_task", {
      task: "Fix the login test",
      workspace: "kitkit",
      effort: "low",
    })).toEqual({
      type: "start",
      task: "Fix the login test",
      workspace: "kitkit",
      effort: "low",
    });
  });

  it("uses the active task when optional thread arguments are omitted", () => {
    expect(codexCommand("continue_codex_task", {
      instruction: "Make the fix smaller",
      effort: "medium",
    })).toEqual({
      type: "continue",
      instruction: "Make the fix smaller",
      effort: "medium",
    });
    expect(codexCommand("get_codex_task_status", {})).toEqual({ type: "status" });
  });

  it("defaults Codex reasoning effort to low", () => {
    expect(codexCommand("start_codex_task", {
      task: "Fix the login test",
    })).toMatchObject({ effort: "low" });
    expect(codexCommand("continue_codex_task", {
      instruction: "Make the fix smaller",
    })).toMatchObject({ effort: "low" });
  });

  it("returns tool failures as data so Realtime can explain them", async () => {
    const bridge = {
      controlCodex: vi.fn().mockRejectedValue(new Error("Shared daemon unavailable")),
    } as unknown as DesktopBridge;

    await expect(executeCodexTool("search_codex", JSON.stringify({ query: "Bob", scope: "all" }), bridge)).resolves.toEqual({
      ok: false,
      error: "Shared daemon unavailable",
    });
  });

  it("routes project and task discovery through the generic Codex tools", () => {
    expect(codexCommand("open_codex", {
      target: "project",
      reference: "hackathon prep",
    })).toEqual({
      type: "open",
      target: "project",
      reference: "hackathon prep",
    });
    expect(codexCommand("search_codex", {
      scope: "all",
      query: "hackathon",
    })).toEqual({
      type: "search",
      scope: "all",
      query: "hackathon",
    });
  });
});
