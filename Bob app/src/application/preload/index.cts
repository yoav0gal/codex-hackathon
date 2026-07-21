const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
import type { DesktopBridge, IpcResult, RealtimeClientSecret, WindowMode } from "../../contracts/ipc.js";
import type { CodexCommand, CodexCommandValue, CodexTaskUpdate } from "../../contracts/codex.js";
import type { ChatSession, NewMessageInput, SessionSummary } from "../../contracts/sessions.js";

const channels: Record<keyof DesktopBridge, string> = {
  getRealtimeClientSecret: "realtime:get-client-secret",
  listSessions: "sessions:list",
  createSession: "sessions:create",
  getSession: "sessions:get",
  appendMessage: "sessions:append-message",
  deleteSession: "sessions:delete",
  getWindowMode: "window:get-mode",
  setWindowMode: "window:set-mode",
  minimizeWindow: "window:minimize",
  closeWindow: "window:close",
  startWakeEngine: "wake:start",
  processWakeAudio: "wake:process-audio",
  stopWakeEngine: "wake:stop",
  controlCodex: "codex:control",
  onCodexTaskUpdate: "codex:task-update",
};

const bridge: DesktopBridge = {
  getRealtimeClientSecret: () => invoke<RealtimeClientSecret>(channels.getRealtimeClientSecret),
  listSessions: () => invoke<SessionSummary[]>(channels.listSessions),
  createSession: () => invoke<ChatSession>(channels.createSession),
  getSession: (id) => invoke<ChatSession>(channels.getSession, id),
  appendMessage: (sessionId, message: NewMessageInput) => (
    invoke<ChatSession>(channels.appendMessage, sessionId, message)
  ),
  deleteSession: (id) => invoke<SessionSummary[]>(channels.deleteSession, id),
  getWindowMode: () => invoke<WindowMode>(channels.getWindowMode),
  setWindowMode: (mode) => invoke<WindowMode>(channels.setWindowMode, mode),
  minimizeWindow: () => invoke<void>(channels.minimizeWindow),
  closeWindow: () => invoke<void>(channels.closeWindow),
  startWakeEngine: () => invoke<void>(channels.startWakeEngine),
  processWakeAudio: (samples, sampleRate) => invoke<boolean>(channels.processWakeAudio, samples, sampleRate),
  stopWakeEngine: () => invoke<void>(channels.stopWakeEngine),
  controlCodex: (command: CodexCommand) => invoke<CodexCommandValue>(channels.controlCodex, command),
  onCodexTaskUpdate: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isCodexTaskUpdate(value)) listener(value);
    };
    ipcRenderer.on(channels.onCodexTaskUpdate, receive);
    return () => ipcRenderer.removeListener(channels.onCodexTaskUpdate, receive);
  },
};

contextBridge.exposeInMainWorld("realtimeApp", bridge);

async function invoke<T>(channel: string, ...arguments_: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...arguments_) as IpcResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function isCodexTaskUpdate(value: unknown): value is CodexTaskUpdate {
  if (!value || typeof value !== "object") return false;
  const update = value as Partial<CodexTaskUpdate>;
  return typeof update.threadId === "string"
    && typeof update.turnId === "string"
    && ["inProgress", "needsAttention", "completed", "failed", "interrupted"].includes(update.status ?? "")
    && typeof update.assistantText === "string"
    && (update.error === undefined || typeof update.error === "string")
    && (update.attention === undefined || (
      typeof update.attention === "object"
      && typeof update.attention.method === "string"
      && (typeof update.attention.requestId === "string" || typeof update.attention.requestId === "number")
    ));
}
