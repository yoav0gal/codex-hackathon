import type { CodexTaskUpdate } from "../../contracts/codex";

/** Returns a stable key only when an incoming Codex event should be spoken. */
export function codexNarrationKey(update: CodexTaskUpdate) {
  if (update.live) {
    if (update.event === "agentMessage" && update.updateText?.trim()) {
      return `${update.threadId}:message:${update.eventId ?? update.updateText}`;
    }
    if (update.event === "attention" || update.event === "error" || update.event === "turnCompleted") {
      return `${update.threadId}:${update.event}:${update.eventId ?? update.turnId}:${update.status}`;
    }
    // Older senders did not attach event metadata. Preserve terminal narration
    // without turning token deltas into dozens of overlapping voice responses.
    if (!update.event && update.status !== "inProgress") {
      return `${update.threadId}:${update.turnId}:${update.status}:${update.attention?.requestId ?? ""}`;
    }
    return undefined;
  }

  if (update.status === "inProgress") return undefined;
  return `${update.threadId}:${update.turnId}:${update.status}:${update.attention?.requestId ?? ""}`;
}
