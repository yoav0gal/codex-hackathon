import { describe, expect, it, vi } from "vitest";
import type { CodexTaskUpdate, CodexThreadSummary } from "../contracts/codex.js";
import type { CodexAppServerClient } from "./app-server-client.js";
import { CodexCapability } from "./capability.js";
import type { DelegationWorkspace } from "./delegation-workspace.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

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
  const workspaces = {
    resolve: vi.fn(async (reference: string) => `/code/${reference}`),
    search: vi.fn().mockResolvedValue(["/code/hackathon-prep"]),
  };
  const capability = new CodexCapability(client as unknown as CodexAppServerClient, {
    delegations: delegations as unknown as DelegationWorkspace,
    workspaces: workspaces as unknown as WorkspaceResolver,
    openExternal,
  });
  return { capability, client, delegations, workspaces, openExternal, emit: (value: CodexTaskUpdate) => listener?.(value) };
}

describe("Codex capability", () => {
  it("starts one shared task in the background without opening Desktop", async () => {
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
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens the Bob Delegations project", async () => {
    const { capability, delegations, openExternal } = setup();

    await expect(capability.execute({ type: "open", target: "delegations" })).resolves.toMatchObject({
      workspace: "/private/tmp/Bob Delegations",
    });
    expect(delegations.ensure).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("codex://threads/new?path=%2Fprivate%2Ftmp%2FBob+Delegations");
  });

  it("opens a named project without creating a task", async () => {
    const { capability, workspaces, openExternal, client } = setup();

    await expect(capability.execute({
      type: "open",
      target: "project",
      reference: "hackathon-prep",
    })).resolves.toMatchObject({ workspace: "/code/hackathon-prep" });

    expect(workspaces.resolve).toHaveBeenCalledWith("hackathon-prep");
    expect(openExternal).toHaveBeenCalledWith("codex://threads/new?path=%2Fcode%2Fhackathon-prep");
    expect(client.startThread).not.toHaveBeenCalled();
  });

  it("searches configured projects and persisted Codex Tasks together", async () => {
    const { capability, workspaces, client } = setup();

    await expect(capability.execute({
      type: "search",
      scope: "all",
      query: "hackathon",
    })).resolves.toMatchObject({
      projects: ["/code/hackathon-prep"],
      threads: [thread],
    });

    expect(workspaces.search).toHaveBeenCalledWith("hackathon");
    expect(client.listThreads).toHaveBeenCalledWith(100, "hackathon");
  });

  it("steers an in-progress task in the background instead of creating a competing turn", async () => {
    const { capability, client, openExternal } = setup({
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
    expect(openExternal).not.toHaveBeenCalled();
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

  it("enables Codex Live for one resolved Task and tags only its updates", async () => {
    const { capability, client, emit } = setup();
    const updates: CodexTaskUpdate[] = [];
    capability.onTaskUpdate((update) => updates.push(update));

    await expect(capability.execute({
      type: "live",
      enabled: true,
      thread: "Fix login",
    })).resolves.toMatchObject({
      codexLive: true,
      threadId: "thread-123",
      connectionMode: "shared",
    });
    expect(client.resumeThread).toHaveBeenCalledWith("thread-123");

    emit({
      threadId: "thread-123",
      turnId: "turn-live",
      status: "inProgress",
      assistantText: "Running tests",
      event: "agentMessage",
      updateText: "Running tests",
    });
    emit({
      threadId: "thread-other",
      turnId: "turn-other",
      status: "completed",
      assistantText: "Done",
      event: "turnCompleted",
    });

    expect(updates[0]).toMatchObject({ threadId: "thread-123", live: true });
    expect(updates[1]?.live).toBeUndefined();
  });

  it("turns Codex Live off without resolving or resuming a Task", async () => {
    const { capability, client } = setup();

    await expect(capability.execute({ type: "live", enabled: false })).resolves.toEqual({
      message: "Codex Live is off.",
      codexLive: false,
    });
    expect(client.listThreads).not.toHaveBeenCalled();
    expect(client.resumeThread).not.toHaveBeenCalled();
  });
});
