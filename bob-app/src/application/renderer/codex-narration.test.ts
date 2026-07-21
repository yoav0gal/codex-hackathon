import { describe, expect, it } from "vitest";
import type { CodexTaskUpdate } from "../../contracts/codex";
import { codexNarrationKey } from "./codex-narration";

function update(overrides: Partial<CodexTaskUpdate> = {}): CodexTaskUpdate {
  return {
    threadId: "thread-live",
    turnId: "turn-1",
    status: "inProgress",
    assistantText: "Checking the tests",
    ...overrides,
  };
}

describe("Codex narration policy", () => {
  it("speaks completed progress messages only for the Codex Live Task", () => {
    const message = update({
      live: true,
      event: "agentMessage",
      eventId: "message-1",
      updateText: "Checking the tests",
    });

    expect(codexNarrationKey(message)).toBe("thread-live:message:message-1");
    expect(codexNarrationKey({ ...message, live: false })).toBeUndefined();
  });

  it("does not speak streaming token deltas", () => {
    expect(codexNarrationKey(update({ live: true, event: "delta", eventId: "message-1" }))).toBeUndefined();
  });

  it("still announces terminal and attention states for ordinary monitored Tasks", () => {
    expect(codexNarrationKey(update({ status: "completed", event: "turnCompleted" }))).toBeTruthy();
    expect(codexNarrationKey(update({ status: "needsAttention", event: "attention" }))).toBeTruthy();
  });

  it("does not replay a historical snapshot when Codex Live is first enabled", () => {
    expect(codexNarrationKey(update({ live: true, status: "completed", event: "snapshot" }))).toBeUndefined();
  });
});
