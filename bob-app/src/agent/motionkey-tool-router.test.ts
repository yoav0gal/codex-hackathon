import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../contracts/ipc";
import { executeMotionKeyTool, motionKeyCommand } from "./motionkey-tool-router";

describe("Bob MotionKey tool routing", () => {
  it("maps a bind action onto a MotionKey command with default hold mode", () => {
    expect(motionKeyCommand("control_motionkey", {
      action: "bind",
      gesture: "joystick-right",
      key: "d",
    })).toEqual({ type: "bind", gesture: "joystick-right", key: "d", mode: "hold" });
  });

  it("maps start flags and list actions", () => {
    expect(motionKeyCommand("control_motionkey", { action: "start", dry_run: true }))
      .toEqual({ type: "start", dryRun: true, preview: false });
    expect(motionKeyCommand("control_motionkey", { action: "list_bindings" }))
      .toEqual({ type: "listBindings" });
  });

  it("rejects unknown actions and tool names", () => {
    expect(() => motionKeyCommand("control_motionkey", { action: "explode" })).toThrow();
    expect(() => motionKeyCommand("something_else", { action: "stop" })).toThrow();
  });

  it("returns tool failures as data so Realtime can explain them", async () => {
    const bridge = {
      controlMotionKey: vi.fn().mockRejectedValue(new Error("MotionKey is not installed")),
    } as unknown as DesktopBridge;

    await expect(executeMotionKeyTool("control_motionkey", JSON.stringify({ action: "status" }), bridge))
      .resolves.toEqual({ ok: false, error: "MotionKey is not installed" });
  });
});
