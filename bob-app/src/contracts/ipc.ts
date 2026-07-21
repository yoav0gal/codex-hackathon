import type { ChatSession, NewMessageInput, SessionSummary } from "./sessions.js";
import type { CodexCommand, CodexCommandValue, CodexTaskUpdate } from "./codex.js";
import type { MotionKeyCommand, MotionKeyResult } from "./motionkey.js";
import type { ChromeCommand, ChromeResult } from "./chrome.js";
import type { ScreenshotCapture } from "./screenshots.js";

export const IPC = {
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
  codexTaskUpdate: "codex:task-update",
  controlMotionKey: "motionkey:control",
  controlChrome: "chrome:control",
  captureScreenshot: "screen:capture",
} as const;

export type WindowMode = "companion" | "full";

export interface RealtimeClientSecret {
  value: string;
}

export interface DesktopBridge {
  getRealtimeClientSecret(): Promise<RealtimeClientSecret>;
  listSessions(): Promise<SessionSummary[]>;
  createSession(): Promise<ChatSession>;
  getSession(id: string): Promise<ChatSession>;
  appendMessage(sessionId: string, message: NewMessageInput): Promise<ChatSession>;
  deleteSession(id: string): Promise<SessionSummary[]>;
  getWindowMode(): Promise<WindowMode>;
  setWindowMode(mode: WindowMode): Promise<WindowMode>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  startWakeEngine(): Promise<void>;
  processWakeAudio(samples: Float32Array, sampleRate: number): Promise<boolean>;
  stopWakeEngine(): Promise<void>;
  controlCodex(command: CodexCommand): Promise<CodexCommandValue>;
  onCodexTaskUpdate(listener: (update: CodexTaskUpdate) => void): () => void;
  controlMotionKey(command: MotionKeyCommand): Promise<MotionKeyResult>;
  controlChrome(command: ChromeCommand): Promise<ChromeResult>;
  captureScreenshot(): Promise<ScreenshotCapture>;
}

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
