import { describe, expect, it } from "vitest";
import { codexUpdateInstruction } from "./realtime-agent";

describe("Codex update speech instructions", () => {
  it("reads a Codex Live progress message instead of the cumulative turn transcript", () => {
    const instruction = codexUpdateInstruction({
      threadId: "thread-1",
      turnId: "turn-1",
      status: "inProgress",
      event: "agentMessage",
      eventId: "message-2",
      assistantText: "First update\n\nSecond update",
      updateText: "Second update",
      live: true,
    });

    expect(instruction).toContain("Read the updateText field aloud");
    expect(instruction).toContain('"updateText":"Second update"');
    expect(instruction).not.toContain("First update");
  });

  it("keeps ordinary task completion narration concise", () => {
    const instruction = codexUpdateInstruction({
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      event: "turnCompleted",
      assistantText: "All tests pass.",
    });

    expect(instruction).toContain("Briefly tell the user");
    expect(instruction).toContain("All tests pass.");
  });

  it("does not repeat the full transcript when a Codex Live turn completes", () => {
    const instruction = codexUpdateInstruction({
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      event: "turnCompleted",
      assistantText: "A long final answer that was already spoken.",
      live: true,
    });

    expect(instruction).toContain("without repeating progress messages");
    expect(instruction).not.toContain("A long final answer");
  });
});
