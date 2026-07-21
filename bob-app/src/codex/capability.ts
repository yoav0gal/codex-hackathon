import path from "node:path";
import type {
  CodexCommand,
  CodexCommandValue,
  CodexEffort,
  CodexOpenTarget,
  CodexSearchScope,
  CodexTaskUpdate,
  CodexThreadSummary,
} from "../contracts/codex.js";
import { CodexAppServerClient, isTerminalCodexStatus } from "./app-server-client.js";
import type { DelegationWorkspace } from "./delegation-workspace.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

export interface CodexCapabilityOptions {
  delegations: DelegationWorkspace;
  workspaces: WorkspaceResolver;
  openExternal(url: string): Promise<void>;
}

/** Intent-level interface used by Electron IPC and Realtime tools. */
export class CodexCapability {
  private activeThreadId: string | undefined;
  private liveThreadId: string | undefined;
  private readonly taskUpdateListeners = new Set<(update: CodexTaskUpdate) => void>();

  constructor(
    private readonly client: CodexAppServerClient,
    private readonly options: CodexCapabilityOptions,
  ) {
    this.client.onUpdate((update) => {
      const outgoing = {
        ...update,
        ...(update.threadId === this.liveThreadId ? { live: true } : {}),
      };
      for (const listener of this.taskUpdateListeners) {
        try {
          listener(outgoing);
        } catch {
          // A renderer observer must not break the app-server event stream.
        }
      }
    });
  }

  onTaskUpdate(listener: (update: CodexTaskUpdate) => void) {
    this.taskUpdateListeners.add(listener);
    return () => this.taskUpdateListeners.delete(listener);
  }

  async execute(command: CodexCommand): Promise<CodexCommandValue> {
    if (command.type === "start") return this.start(command.task, command.workspace, command.effort);
    if (command.type === "continue") return this.continue(command.instruction, command.thread, command.effort);
    if (command.type === "monitor") return this.monitor(command.thread);
    if (command.type === "live") return this.setLive(command.enabled, command.thread);
    if (command.type === "interrupt") return this.interrupt(command.thread);
    if (command.type === "open") return this.open(command.target, command.reference);
    if (command.type === "search") return this.search(command.scope, command.query);
    return this.status(command.thread);
  }

  async connect() {
    return this.client.connect();
  }

  dispose() {
    this.client.dispose();
  }

  private async start(task: string, workspaceReference: string | undefined, effort: CodexEffort) {
    const workspace = workspaceReference
      ? await this.resolveWorkspace(workspaceReference)
      : await this.options.delegations.ensure();
    const connection = await this.client.connect();
    const threadId = await this.client.startThread(workspace, effort);
    this.activeThreadId = threadId;
    const turnId = await this.client.startTurn(threadId, task, effort);
    return {
      message: "Started the Codex Task in the background. Bob will report completion or anything requiring attention.",
      threadId,
      turnId,
      workspace,
      connectionMode: connection.mode,
      ...(connection.serverVersion ? { serverVersion: connection.serverVersion } : {}),
    } satisfies CodexCommandValue;
  }

  private async continue(instruction: string, reference: string | undefined, effort: CodexEffort) {
    const thread = await this.resolveThread(reference);
    const connection = await this.client.connect();
    await this.client.resumeThread(thread.id);
    this.activeThreadId = thread.id;
    const current = this.client.getLatestUpdate(thread.id);
    if (current?.status === "needsAttention") {
      throw new Error("This Codex Task is waiting for attention in Codex Desktop. Resolve that request there before continuing it.");
    }
    const turnId = current?.status === "inProgress"
      ? await this.client.steerTurn(thread.id, current.turnId, instruction)
      : await this.client.startTurn(thread.id, instruction, effort);
    return {
      message: current?.status === "inProgress"
        ? "Steered the active Codex turn in the background. Bob remains subscribed to its live updates."
        : "Continued the Codex Task in a new background turn. Bob remains subscribed to its live updates.",
      threadId: thread.id,
      turnId,
      workspace: thread.workspace,
      connectionMode: connection.mode,
      ...(connection.serverVersion ? { serverVersion: connection.serverVersion } : {}),
    } satisfies CodexCommandValue;
  }

  private async monitor(reference: string) {
    const thread = await this.resolveThread(reference);
    const connection = await this.client.connect();
    await this.client.resumeThread(thread.id);
    this.activeThreadId = thread.id;
    const task = this.client.getLatestUpdate(thread.id);
    return {
      message: `Bob is now monitoring “${thread.title}” and will report completion or anything requiring attention.`,
      threadId: thread.id,
      workspace: thread.workspace,
      connectionMode: connection.mode,
      ...(connection.serverVersion ? { serverVersion: connection.serverVersion } : {}),
      ...(task ? { task } : {}),
    } satisfies CodexCommandValue;
  }

  private async setLive(enabled: boolean, reference: string | undefined) {
    if (!enabled) {
      this.liveThreadId = undefined;
      return {
        message: "Codex Live is off.",
        codexLive: false,
      } satisfies CodexCommandValue;
    }

    const thread = await this.resolveThread(reference);
    const connection = await this.client.connect();
    const previous = this.liveThreadId;
    this.liveThreadId = thread.id;
    try {
      await this.client.resumeThread(thread.id);
    } catch (error) {
      this.liveThreadId = previous;
      throw error;
    }
    this.activeThreadId = thread.id;
    return {
      message: `Codex Live is on for “${thread.title}”. Bob will read its progress updates aloud while the Realtime Session is connected.`,
      threadId: thread.id,
      workspace: thread.workspace,
      connectionMode: connection.mode,
      ...(connection.serverVersion ? { serverVersion: connection.serverVersion } : {}),
      codexLive: true,
    } satisfies CodexCommandValue;
  }

  private async interrupt(reference: string | undefined) {
    const thread = await this.resolveThread(reference);
    await this.client.resumeThread(thread.id);
    const task = this.client.getLatestUpdate(thread.id);
    if (!task || isTerminalCodexStatus(task.status)) {
      throw new Error("That Codex Task has no active turn to interrupt.");
    }
    await this.client.interruptTurn(thread.id, task.turnId);
    this.activeThreadId = thread.id;
    return {
      message: "Asked Codex to interrupt the active turn.",
      threadId: thread.id,
      turnId: task.turnId,
      workspace: thread.workspace,
      connectionMode: "shared",
    } satisfies CodexCommandValue;
  }

  private async open(target: CodexOpenTarget, reference: string | undefined) {
    if (target === "app") {
      const url = this.activeThreadId
        ? threadUrl(this.activeThreadId)
        : projectUrl(await this.options.delegations.ensure());
      await this.options.openExternal(url);
      return { message: "Opened the current Codex view in Codex Desktop." } satisfies CodexCommandValue;
    }
    if (target === "delegations") {
      const workspace = await this.options.delegations.ensure();
      await this.options.openExternal(projectUrl(workspace));
      return { message: "Opened the Bob Delegations project in Codex Desktop.", workspace } satisfies CodexCommandValue;
    }
    if (target === "project") {
      if (!reference?.trim()) throw new Error("Tell Bob which code project to open.");
      const workspace = await this.options.workspaces.resolve(reference);
      await this.options.openExternal(projectUrl(workspace));
      return {
        message: `Opened the ${path.basename(workspace)} project in Codex Desktop.`,
        workspace,
      } satisfies CodexCommandValue;
    }
    if (!reference?.trim()) throw new Error("Tell Bob which Codex Task to open.");
    const thread = await this.resolveThread(reference);
    this.activeThreadId = thread.id;
    await this.options.openExternal(threadUrl(thread.id));
    return {
      message: `Opened “${thread.title}” in Codex Desktop.`,
      threadId: thread.id,
      workspace: thread.workspace,
    } satisfies CodexCommandValue;
  }

  private async search(scope: CodexSearchScope, query: string) {
    const projects = scope === "threads" ? undefined : await this.searchProjects(query);
    const threads = scope === "projects" ? undefined : await this.client.listThreads(100, query);
    const projectCount = projects?.length ?? 0;
    const threadCount = threads?.length ?? 0;
    return {
      message: `Found ${projectCount} project${projectCount === 1 ? "" : "s"} and ${threadCount} Codex Task${threadCount === 1 ? "" : "s"}.`,
      ...(projects ? { projects } : {}),
      ...(threads ? { threads } : {}),
      ...(threads ? { connectionMode: "shared" as const } : {}),
    } satisfies CodexCommandValue;
  }

  private async searchProjects(query: string) {
    const projects = await this.options.workspaces.search(query);
    const delegationWorkspace = await this.options.delegations.ensure();
    const wanted = normalize(query);
    const delegationMatches = !wanted
      || normalize("Bob Delegations").includes(wanted)
      || normalize(delegationWorkspace).includes(wanted);
    return delegationMatches
      ? [delegationWorkspace, ...projects.filter((project) => project !== delegationWorkspace)]
      : projects;
  }

  private async status(reference: string | undefined) {
    const thread = await this.resolveThread(reference);
    await this.client.resumeThread(thread.id);
    this.activeThreadId = thread.id;
    const task = this.client.getLatestUpdate(thread.id);
    return {
      message: task
        ? taskStatusMessage(thread.title, task)
        : `Bob is subscribed to “${thread.title}”, but it has no available turn state yet.`,
      threadId: thread.id,
      workspace: thread.workspace,
      connectionMode: "shared",
      ...(task ? { turnId: task.turnId, task } : {}),
    } satisfies CodexCommandValue;
  }

  private async resolveThread(reference: string | undefined): Promise<CodexThreadSummary> {
    const wanted = reference?.trim() || this.activeThreadId;
    if (!wanted) throw new Error("Tell Bob which Codex Task to use.");
    const recent = await this.client.listThreads(100, wanted);
    const candidates = recent.length > 0 ? recent : await this.client.listThreads(100);
    const exactId = candidates.find((thread) => thread.id === wanted);
    if (exactId) return exactId;
    const normalized = normalize(wanted);
    const ranked = candidates
      .map((thread) => ({ thread, score: threadScore(thread, normalized) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || right.thread.updatedAt - left.thread.updatedAt);
    const best = ranked[0];
    if (!best) throw new Error(`Bob could not find a Codex Task matching “${wanted}”.`);
    if (ranked[1]?.score === best.score && ranked[1].thread.title !== best.thread.title) {
      throw new Error("Bob found more than one close Codex Task. Say more of its title.");
    }
    return best.thread;
  }

  private async resolveWorkspace(reference: string | undefined) {
    return reference?.trim()
      ? this.options.workspaces.resolve(reference)
      : this.options.delegations.ensure();
  }
}

function threadScore(thread: CodexThreadSummary, wanted: string) {
  const title = normalize(thread.title);
  const preview = normalize(thread.preview);
  if (title === wanted) return 1_000;
  if (preview === wanted) return 950;
  if (title.includes(wanted)) return 800;
  if (preview.includes(wanted)) return 750;
  const words = wanted.split(" ").filter(Boolean);
  if (words.length > 0 && words.every((word) => title.includes(word))) return 600;
  if (words.length > 0 && words.every((word) => preview.includes(word))) return 550;
  return 0;
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function threadUrl(threadId: string) {
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

function projectUrl(workspace: string) {
  return `codex://threads/new?${new URLSearchParams({ path: workspace }).toString()}`;
}

function taskStatusMessage(title: string, task: CodexTaskUpdate) {
  if (task.status === "needsAttention") return `“${title}” needs attention in Codex Desktop.`;
  if (task.status === "completed") return `“${title}” completed.${task.assistantText ? ` ${task.assistantText}` : ""}`;
  if (task.status === "failed") return `“${title}” failed.${task.error ? ` ${task.error}` : ""}`;
  if (task.status === "interrupted") return `“${title}” was interrupted.`;
  return `“${title}” is still in progress.${task.assistantText ? ` Latest update: ${task.assistantText}` : ""}`;
}
