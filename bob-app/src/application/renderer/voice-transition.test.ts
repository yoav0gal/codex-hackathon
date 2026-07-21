import { describe, expect, it } from "vitest";
import { voiceToggleAction } from "./realtime-desktop-app";

describe("voice mode transitions", () => {
  it("connects voice when Bob is already awake in text mode", () => {
    expect(voiceToggleAction({ status: "ready", mode: "text" }, true)).toBe("connect");
  });

  it("wakes into voice from sleep and sleeps from every active voice phase", () => {
    expect(voiceToggleAction({ status: "disconnected" }, false)).toBe("wake");

    for (const status of ["connecting", "listening", "thinking", "speaking"] as const) {
      expect(voiceToggleAction({ status, mode: "voice" }, true)).toBe("sleep");
    }
  });

  it("retries voice after a failed voice connection", () => {
    expect(voiceToggleAction({ status: "error", mode: "voice" }, false)).toBe("wake");
  });
});
