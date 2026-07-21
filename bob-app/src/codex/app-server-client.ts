import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  CodexEffort,
  CodexTaskUpdate,
  CodexThreadSummary,
  CodexTurnStatus,
} from "../contracts/codex.js";
import { BOB_THREAD_EXECUTION_POLICY, BOB_TURN_EXECUTION_POLICY } from "./execution-policy.js";
import { ProxyWebSocket } from "./proxy-websocket.js";

type JsonObject = Record<string, unknown>;

interface JsonRpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { message?: unknown };
  method?: unknown;
  params?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface CodexAppServerClientOptions {
  codexBinary: string;
  model?: string;
  spawnProcess?: typeof spawn;
  reconnectDelaysMs?: number[];
  loadedThreadPollMs?: number;
}

const INTERACTIVE_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
  "applyPatchApproval",
  "execCommandApproval",
]);

const TERMINAL_STATUSES = new Set<CodexTurnStatus>(["completed", "failed", "interrupted"]);
const MINIMUM_SHARED_VERSION = "0.144.0";

/**
 * A shared-daemon Codex client for Bob.
 *
 * This module owns daemon lifecycle, transport, JSON-RPC, subscriptions,
 * reconnection, and Bob's autonomous execution policy. It still observes
 * interactive requests from tasks created elsewhere without answering them.
 */
export class CodexAppServerClient {
  private readonly spawnProcess: typeof spawn;
  private readonly model: string;
  private readonly reconnectDelaysMs: number[];
  private readonly loadedThreadPollMs: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private daemonStarter: ChildProcessWithoutNullStreams | undefined;
  private wire: ProxyWebSocket | undefined;
  private startup: Promise<void> | undefined;
  private disposed = false;
  private nextRequestId = 1;
  private serverVersion: string | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private discoveryTimer: ReturnType<typeof setInterval> | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscriptions = new Set<string>();
  private readonly updates = new Map<string, CodexTaskUpdate>();
  private readonly assistantItems = new Map<string, Map<string, string>>();
  private readonly attentionRequests = new Map<string, {
    threadId: string;
    turnId: string;
    method: string;
    requestId: string | number;
  }>();
  private readonly listeners = new Set<(update: CodexTaskUpdate) => void>();

  constructor(private readonly options: CodexAppServerClientOptions) {
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.model = options.model ?? "gpt-5.6-terra";
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [250, 1_000, 3_000, 10_000];
    this.loadedThreadPollMs = options.loadedThreadPollMs ?? 5_000;
  }

  async connect() {
    await this.ensureConnected();
    return { mode: "shared" as const, serverVersion: this.serverVersion };
  }

  async listThreads(limit = 50, query = ""): Promise<CodexThreadSummary[]> {
    const response = asObject(await this.request("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      ...(query.trim() ? { searchTerm: query.trim() } : {}),
    }));
    if (!Array.isArray(response.data)) throw new Error("Codex returned an invalid task list.");
    return response.data.map(threadSummary);
  }

  async startThread(workspace: string, effort: CodexEffort) {
    const response = asObject(await this.request("thread/start", {
      cwd: workspace,
      model: this.model,
      ...BOB_THREAD_EXECUTION_POLICY,
      serviceName: "bob",
      config: { model_reasoning_effort: effort },
      developerInstructions: "Work autonomously with full local access and explain genuine blockers. Do not pause for approval. When visual verification is relevant, use screenshot capability and send the screenshots to the live model as part of the workflow. Required user input must remain visible in Codex Desktop; Bob only observes and reports it.",
    }));
    const thread = asObject(response.thread);
    const threadId = requiredString(thread.id, "Codex did not return a task ID.");
    this.subscriptions.add(threadId);
    return threadId;
  }

  async resumeThread(threadId: string, includeTurns = true) {
    const response = asObject(await this.request("thread/resume", {
      threadId,
      ...BOB_THREAD_EXECUTION_POLICY,
      excludeTurns: !includeTurns,
    }));
    this.subscriptions.add(threadId);
    if (includeTurns) this.captureResumedThread(threadId, asObject(response.thread));
    return threadId;
  }

  async startTurn(threadId: string, text: string, effort: CodexEffort) {
    const prompt = requiredText(text, "Tell Bob what Codex should do.");
    if (!this.subscriptions.has(threadId)) await this.resumeThread(threadId);
    const response = asObject(await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      model: this.model,
      effort,
      ...BOB_TURN_EXECUTION_POLICY,
    }));
    const turn = asObject(response.turn);
    const turnId = requiredString(turn.id, "Codex did not return a turn ID.");
    if (!this.updates.has(turnId)) {
      this.publish({ threadId, turnId, status: "inProgress", assistantText: "" });
    }
    return turnId;
  }

  async steerTurn(threadId: string, turnId: string, text: string) {
    const instruction = requiredText(text, "Tell Bob how Codex should adjust the active task.");
    await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: instruction }],
    });
    return turnId;
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  getLatestUpdate(threadId?: string) {
    const values = [...this.updates.values()];
    const update = threadId
      ? values.reverse().find((candidate) => candidate.threadId === threadId)
      : values.at(-1);
    return update ? cloneUpdate(update) : undefined;
  }

  onUpdate(listener: (update: CodexTaskUpdate) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.reconnectTimer = undefined;
    this.discoveryTimer = undefined;
    const child = this.child;
    const daemonStarter = this.daemonStarter;
    this.child = undefined;
    this.daemonStarter = undefined;
    this.wire = undefined;
    this.startup = undefined;
    this.rejectPending(new Error("Bob stopped the shared Codex connection."));
    child?.kill();
    daemonStarter?.kill();
  }

  private ensureConnected() {
    if (!this.startup) {
      const startup = this.startConnection();
      this.startup = startup;
      void startup.catch(() => {
        if (this.startup === startup) this.startup = undefined;
      });
    }
    return this.startup;
  }

  private async startConnection() {
    if (this.disposed) throw new Error("Bob's Codex connection has been stopped.");
    await this.startDaemon();
    if (this.disposed) throw new Error("Bob's Codex connection has been stopped.");

    const child = this.spawnProcess(this.options.codexBinary, ["app-server", "proxy"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    child.once("error", (error) => this.connectionEnded(child, new Error(`Bob could not start the shared Codex proxy: ${error.message}`)));
    child.once("exit", (code, signal) => {
      const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      this.connectionEnded(child, new Error(compactProcessError(`The shared Codex proxy ended (${status})`, stderr)));
    });

    try {
      const wire = new ProxyWebSocket(child, (message) => this.receive(message));
      this.wire = wire;
      await wire.open(15_000);
      const initialized = asObject(await this.requestWithoutStartup("initialize", {
        clientInfo: { name: "bob", title: "Bob", version: "0.1.0" },
        capabilities: null,
      }));
      this.send({ method: "initialized", params: {} });
      this.serverVersion = parseCodexVersion(initialized.userAgent);
      if (!this.serverVersion || compareVersions(this.serverVersion, MINIMUM_SHARED_VERSION) < 0) {
        throw new Error(`The shared Codex daemon must be version ${MINIMUM_SHARED_VERSION} or newer.`);
      }
      await this.restoreSubscriptions();
      await this.discoverLoadedThreads();
      this.reconnectAttempt = 0;
      this.startDiscoveryLoop();
    } catch (error) {
      if (this.child === child) {
        this.child = undefined;
        this.wire = undefined;
      }
      child.kill();
      throw error;
    }
  }

  private async startDaemon() {
    await new Promise<void>((resolve, reject) => {
      const child = this.spawnProcess(this.options.codexBinary, ["app-server", "daemon", "start"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.daemonStarter = child;
      let output = "";
      let settled = false;
      const append = (chunk: unknown) => {
        output = `${output}${String(chunk)}`.slice(-8_000);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.stdin.end();
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error("The managed Codex daemon start timed out."));
      }, 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.daemonStarter === child) this.daemonStarter = undefined;
        if (error) reject(error);
        else resolve();
      };
      child.once("error", (error) => finish(new Error(`Bob could not start the managed Codex daemon: ${error.message}`)));
      child.once("exit", (code, signal) => {
        if (code === 0) finish();
        else {
          const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
          finish(new Error(compactProcessError(`The managed Codex daemon start ended with ${status}`, output)));
        }
      });
    });
  }

  private async restoreSubscriptions() {
    for (const threadId of [...this.subscriptions]) {
      try {
        await this.requestWithoutStartup("thread/resume", {
          threadId,
          excludeTurns: true,
        });
      } catch {
        this.subscriptions.delete(threadId);
      }
    }
  }

  private startDiscoveryLoop() {
    if (this.discoveryTimer || this.disposed) return;
    this.discoveryTimer = setInterval(() => {
      if (this.child) void this.discoverLoadedThreads().catch(() => undefined);
    }, this.loadedThreadPollMs);
  }

  private async discoverLoadedThreads() {
    const response = asObject(await this.requestWithoutStartup("thread/loaded/list", { limit: 100 }));
    if (!Array.isArray(response.data)) return;
    for (const candidate of response.data) {
      if (typeof candidate !== "string" || this.subscriptions.has(candidate)) continue;
      try {
        await this.requestWithoutStartup("thread/resume", {
          threadId: candidate,
          excludeTurns: true,
        });
        this.subscriptions.add(candidate);
      } catch {
        // A task can unload between discovery and resume; the next poll retries
        // only if it becomes loaded again.
      }
    }
  }

  private async request(method: string, params: JsonObject) {
    await this.ensureConnected();
    return this.requestWithoutStartup(method, params);
  }

  private requestWithoutStartup(method: string, params: JsonObject) {
    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ method, id, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private send(message: JsonObject) {
    if (!this.child || !this.wire || this.child.stdin.destroyed) {
      throw new Error("Bob is not connected to the shared Codex daemon.");
    }
    this.wire.send(JSON.stringify(message));
  }

  private receive(raw: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }
    if (typeof message.method === "string" && message.id !== undefined) {
      this.receiveServerRequest(message.method, message.id, message.params);
      return;
    }
    if (typeof message.method === "string") {
      this.receiveNotification(message.method, message.params);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(typeof message.error.message === "string" ? message.error.message : "Codex returned an app-server error."));
    } else {
      pending.resolve(message.result);
    }
  }

  private receiveServerRequest(method: string, requestId: unknown, params: unknown) {
    if (!INTERACTIVE_REQUESTS.has(method)) return;
    if (typeof requestId !== "string" && typeof requestId !== "number") return;
    const payload = maybeObject(params);
    const threadId = optionalString(payload?.threadId);
    const turnId = optionalString(payload?.turnId);
    if (!threadId || !turnId) return;
    this.attentionRequests.set(requestKey(requestId), { threadId, turnId, method, requestId });
    const current = this.updates.get(turnId);
    this.publish({
      threadId,
      turnId,
      status: "needsAttention",
      assistantText: current?.assistantText ?? this.assistantText(turnId),
      ...(current?.error ? { error: current.error } : {}),
      attention: { method, requestId },
    });
    // Codex Desktop is the approval authority. Bob deliberately never answers
    // this reverse request because app-server accepts the first response.
  }

  private receiveNotification(method: string, params: unknown) {
    const payload = maybeObject(params);
    if (!payload) return;
    if (method === "item/agentMessage/delta") this.receiveAgentDelta(payload);
    if (method === "item/completed") this.receiveCompletedItem(payload);
    if (method === "turn/started") this.receiveTurnStarted(payload);
    if (method === "turn/completed") this.receiveTurnCompleted(payload);
    if (method === "error") this.receiveTurnError(payload);
    if (method === "serverRequest/resolved") this.receiveRequestResolved(payload);
  }

  private receiveAgentDelta(payload: JsonObject) {
    const threadId = optionalString(payload.threadId);
    const turnId = optionalString(payload.turnId);
    const itemId = optionalString(payload.itemId);
    const delta = optionalString(payload.delta);
    if (!threadId || !turnId || !itemId || delta === undefined) return;
    const items = this.itemTexts(turnId);
    items.set(itemId, `${items.get(itemId) ?? ""}${delta}`);
    const current = this.updates.get(turnId);
    this.publish({
      threadId,
      turnId,
      status: current?.status ?? "inProgress",
      assistantText: this.assistantText(turnId),
      ...(current?.error ? { error: current.error } : {}),
      ...(current?.attention ? { attention: current.attention } : {}),
    });
  }

  private receiveCompletedItem(payload: JsonObject) {
    const item = maybeObject(payload.item);
    const threadId = optionalString(payload.threadId);
    const turnId = optionalString(payload.turnId);
    if (!item || !threadId || !turnId || item.type !== "agentMessage") return;
    const itemId = optionalString(item.id);
    const text = optionalString(item.text);
    if (!itemId || text === undefined) return;
    this.itemTexts(turnId).set(itemId, text);
    const current = this.updates.get(turnId);
    this.publish({
      threadId,
      turnId,
      status: current?.status ?? "inProgress",
      assistantText: this.assistantText(turnId),
      ...(current?.error ? { error: current.error } : {}),
      ...(current?.attention ? { attention: current.attention } : {}),
    });
  }

  private receiveTurnStarted(payload: JsonObject) {
    const threadId = optionalString(payload.threadId);
    const turnId = optionalString(maybeObject(payload.turn)?.id);
    if (!threadId || !turnId) return;
    this.subscriptions.add(threadId);
    this.publish({ threadId, turnId, status: "inProgress", assistantText: this.assistantText(turnId) });
  }

  private receiveTurnCompleted(payload: JsonObject) {
    const threadId = optionalString(payload.threadId);
    const turn = maybeObject(payload.turn);
    const turnId = optionalString(turn?.id);
    if (!threadId || !turnId) return;
    this.captureTurnItems(turnId, turn?.items);
    const rawStatus = optionalString(turn?.status);
    const status: CodexTurnStatus = rawStatus === "completed" || rawStatus === "failed" || rawStatus === "interrupted"
      ? rawStatus
      : "failed";
    const protocolError = status === rawStatus ? undefined : `Codex returned invalid turn status ${rawStatus ?? "missing"}.`;
    const error = optionalString(maybeObject(turn?.error)?.message) ?? protocolError;
    this.clearAttention(turnId);
    this.publish({
      threadId,
      turnId,
      status,
      assistantText: this.assistantText(turnId),
      ...(error ? { error } : {}),
    });
  }

  private receiveTurnError(payload: JsonObject) {
    const threadId = optionalString(payload.threadId);
    const turnId = optionalString(payload.turnId);
    const error = optionalString(maybeObject(payload.error)?.message);
    if (!threadId || !turnId || !error) return;
    const current = this.updates.get(turnId);
    this.publish({
      threadId,
      turnId,
      status: current?.status ?? "inProgress",
      assistantText: current?.assistantText ?? this.assistantText(turnId),
      error,
      ...(current?.attention ? { attention: current.attention } : {}),
    });
  }

  private receiveRequestResolved(payload: JsonObject) {
    const requestId = payload.requestId;
    if (typeof requestId !== "string" && typeof requestId !== "number") return;
    const attention = this.attentionRequests.get(requestKey(requestId));
    if (!attention) return;
    this.attentionRequests.delete(requestKey(requestId));
    const current = this.updates.get(attention.turnId);
    if (!current) return;
    const remaining = [...this.attentionRequests.values()].find((request) => request.turnId === attention.turnId);
    this.publish({
      threadId: attention.threadId,
      turnId: attention.turnId,
      status: remaining ? "needsAttention" : "inProgress",
      assistantText: current.assistantText,
      ...(current.error ? { error: current.error } : {}),
      ...(remaining ? { attention: { method: remaining.method, requestId: remaining.requestId } } : {}),
    });
  }

  private captureResumedThread(threadId: string, thread: JsonObject) {
    if (!Array.isArray(thread.turns) || thread.turns.length === 0) return;
    const turn = maybeObject(thread.turns.at(-1));
    const turnId = optionalString(turn?.id);
    const status = optionalString(turn?.status);
    if (!turnId || !status) return;
    this.captureTurnItems(turnId, turn?.items);
    if (status === "completed" || status === "failed" || status === "interrupted") {
      this.publish({
        threadId,
        turnId,
        status,
        assistantText: this.assistantText(turnId),
        ...(optionalString(maybeObject(turn?.error)?.message) ? { error: optionalString(maybeObject(turn?.error)?.message) } : {}),
      });
    } else if (status === "inProgress") {
      this.publish({
        threadId,
        turnId,
        status: "inProgress",
        assistantText: this.assistantText(turnId),
      });
    }
  }

  private captureTurnItems(turnId: string, value: unknown) {
    if (!Array.isArray(value)) return;
    for (const candidate of value) {
      const item = maybeObject(candidate);
      if (item?.type !== "agentMessage") continue;
      const itemId = optionalString(item.id);
      const text = optionalString(item.text);
      if (itemId && text !== undefined) this.itemTexts(turnId).set(itemId, text);
    }
  }

  private itemTexts(turnId: string) {
    let items = this.assistantItems.get(turnId);
    if (!items) {
      items = new Map();
      this.assistantItems.set(turnId, items);
    }
    return items;
  }

  private assistantText(turnId: string) {
    return [...(this.assistantItems.get(turnId)?.values() ?? [])].join("\n\n");
  }

  private clearAttention(turnId: string) {
    for (const [key, attention] of this.attentionRequests) {
      if (attention.turnId === turnId) this.attentionRequests.delete(key);
    }
  }

  private publish(update: CodexTaskUpdate) {
    this.updates.set(update.turnId, cloneUpdate(update));
    for (const listener of this.listeners) {
      try {
        listener(cloneUpdate(update));
      } catch {
        // Observers must not break the transport read loop.
      }
    }
  }

  private connectionEnded(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child) return;
    this.child = undefined;
    this.wire = undefined;
    this.startup = undefined;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = undefined;
    this.rejectPending(error);
    if (!this.disposed) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disposed) return;
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? 10_000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private rejectPending(error: Error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

function threadSummary(value: unknown): CodexThreadSummary {
  const thread = asObject(value);
  const name = optionalString(thread.name)?.trim();
  const preview = optionalString(thread.preview) ?? "";
  return {
    id: requiredString(thread.id, "Codex returned a task without an ID."),
    title: name || preview.trim() || requiredString(thread.id, "Codex returned a task without an ID."),
    preview,
    workspace: requiredString(thread.cwd, "Codex returned a task without a workspace."),
    updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
  };
}

function cloneUpdate(update: CodexTaskUpdate): CodexTaskUpdate {
  return {
    ...update,
    ...(update.attention ? { attention: { ...update.attention } } : {}),
  };
}

function asObject(value: unknown): JsonObject {
  const result = maybeObject(value);
  if (!result) throw new Error("Codex returned an invalid response.");
  return result;
}

function maybeObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}

function requiredText(value: string, message: string) {
  const text = value.trim();
  if (!text) throw new Error(message);
  if (text.length > 100_000) throw new Error("The Codex instruction is too long.");
  return text;
}

function requestKey(id: string | number) {
  return `${typeof id}:${id}`;
}

function parseCodexVersion(userAgent: unknown) {
  if (typeof userAgent !== "string") return undefined;
  return /codex(?:_cli_rs)?(?: desktop)?[/ ]v?(\d+\.\d+\.\d+)/i.exec(userAgent)?.[1];
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compactProcessError(prefix: string, output: string) {
  const detail = output.trim().replace(/\s+/g, " ");
  return detail ? `${prefix}: ${detail}` : prefix;
}

export function isTerminalCodexStatus(status: CodexTurnStatus) {
  return TERMINAL_STATUSES.has(status);
}
