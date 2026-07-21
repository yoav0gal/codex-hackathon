import { describe, expect, it, vi } from "vitest";
import type { CodexTaskUpdate, CodexThreadSummary } from "../contracts/codex.js";
import type { CodexAppServerClient } from "./app-server-client.js";
import { CodexCapability } from "./capability.js";
import type { DelegationWorkspace } from "./delegation-workspace.js";

const thread: CodexThreadSummary = {
  id: "thread-123",
  title: "Fix login",
  preview: "Fix the login test",
  workspace: "/tmp",
  updatedAt: 10,
};

function setup(update?: CodexTaskUpdate) {
  let listener: ((value: CodexTaskUpdate) => void) | undefined;
  const client = {
    onUpdate: vi.fn((next) => {
      listener = next;
      return () => undefined;
    }),
    connect: vi.fn().mockResolvedValue({ mode: "shared", serverVersion: "0.144.6" }),
    startThread: vi.fn().mockResolvedValue("thread-123"),
    startTurn: vi.fn().mockResolvedValue("turn-new"),
    steerTurn: vi.fn().mockResolvedValue("turn-active"),
    resumeThread: vi.fn().mockResolvedValue("thread-123"),
    interruptTurn: vi.fn().mockResolvedValue(undefined),
    listThreads: vi.fn().mockResolvedValue([thread]),
    getLatestUpdate: vi.fn().mockReturnValue(update),
    dispose: vi.fn(),
  };
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const delegations = {
    ensure: vi.fn().mockResolvedValue("/private/tmp/Bob Delegations"),
  };
  const capability = new CodexCapability(client as unknown as CodexAppServerClient, {
    delegations: delegations as unknown as DelegationWorkspace,
    workspaceRoots: ["/tmp"],
    openExternal,
  });
  return { capability, client, delegations, openExternal, emit: (value: CodexTaskUpdate) => listener?.(value) };
}

describe("Codex capability", () => {
  it("starts one shared task and opens the same Desktop thread", async () => {
    const { capability, client, openExternal } = setup();

    await expect(capability.execute({
      type: "start",
      task: "Fix the login test",
      effort: "medium",
    })).resolves.toMatchObject({
      threadId: "thread-123",
      turnId: "turn-new",
      workspace: "/private/tmp/Bob Delegations",
      connectionMode: "shared",
    });
    expect(client.startThread).toHaveBeenCalledWith("/private/tmp/Bob Delegations", "medium");
    expect(client.startTurn).toHaveBeenCalledWith("thread-123", "Fix the login test", "medium");
    expect(openExternal).toHaveBeenCalledWith("codex://threads/thread-123");
    expect(client.startTurn.mock.invocationCallOrder[0]).toBeLessThan(openExternal.mock.invocationCallOrder[0]);
  });

  it("opens the Bob Delegations project when no task is active", async () => {
    const { capability, delegations, openExternal } = setup();

    await expect(capability.execute({ type: "open" })).resolves.toMatchObject({
      workspace: "/private/tmp/Bob Delegations",
    });
    expect(delegations.ensure).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("codex://threads/new?path=%2Fprivate%2Ftmp%2FBob+Delegations");
  });

  it("steers an in-progress task instead of creating a competing turn", async () => {
    const { capability, client } = setup({
      threadId: "thread-123",
      turnId: "turn-active",
      status: "inProgress",
      assistantText: "Working",
    });

    await capability.execute({
      type: "continue",
      instruction: "Keep the change focused",
      thread: "Fix login",
      effort: "medium",
    });

    expect(client.steerTurn).toHaveBeenCalledWith("thread-123", "turn-active", "Keep the change focused");
    expect(client.startTurn).not.toHaveBeenCalled();
  });

  it("never steers through an approval request", async () => {
    const { capability, client } = setup({
      threadId: "thread-123",
      turnId: "turn-active",
      status: "needsAttention",
      assistantText: "",
      attention: { method: "item/commandExecution/requestApproval", requestId: 7 },
    });

    await expect(capability.execute({
      type: "continue",
      instruction: "Approve it",
      thread: "Fix login",
      effort: "medium",
    })).rejects.toThrow("Resolve that request there");
    expect(client.steerTurn).not.toHaveBeenCalled();
  });
});
