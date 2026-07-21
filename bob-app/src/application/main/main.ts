import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, screen, session, shell } from "electron";
import { config } from "dotenv";
import { CodexAppServerClient } from "../../codex/app-server-client.js";
import { CodexCapability } from "../../codex/capability.js";
import { DelegationWorkspace } from "../../codex/delegation-workspace.js";
import { WorkspaceResolver } from "../../codex/workspace-resolver.js";
import type { CodexCommand, CodexCommandValue } from "../../contracts/codex.js";
import { IPC, type IpcResult, type WindowMode } from "../../contracts/ipc.js";
import type { ChatSession, NewMessageInput, SessionSummary } from "../../contracts/sessions.js";
import { mintRealtimeClientSecret } from "./realtime-secret.js";
import { SessionStore } from "./session-store.js";
import { SherpaWakeEngine } from "./sherpa-wake-engine.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const localEnvironment: Record<string, string> = {};
config({ path: path.join(app.getAppPath(), ".env.local"), processEnv: localEnvironment, quiet: true });

let mainWindow: BrowserWindow | undefined;
let sessions: SessionStore;
let codex: CodexCapability;
let windowMode: WindowMode = "companion";
const wakeEngine = new SherpaWakeEngine(app.getAppPath());

const companionSize = 128;
const companionMargin = 18;
const preferredFullSize = { width: 1180, height: 780 };
const minimumFullSize = { width: 860, height: 600 };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    setWindowMode("full");
  });

  app.whenReady().then(() => {
    sessions = new SessionStore(path.join(app.getPath("userData"), "sessions.json"));
    codex = createCodexCapability();
    registerIpc();
    configureMediaPermissions();
    createWindow();
  });
}

app.on("activate", () => {
  if (!mainWindow) createWindow();
  else setWindowMode("full");
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  codex?.dispose();
  wakeEngine.dispose();
});

function createWindow() {
  const companionBounds = getCompanionBounds();
  mainWindow = new BrowserWindow({
    ...companionBounds,
    minWidth: 1,
    minHeight: 1,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: "Bob",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.resolve(currentDirectory, "../preload/index.cjs"),
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.once("ready-to-show", () => mainWindow?.showInactive());

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media" && webContents === mainWindow?.webContents);
  });
}

function registerIpc() {
  ipcMain.handle(IPC.getRealtimeClientSecret, async (): Promise<IpcResult<{ value: string }>> => protect(async () => (
    mintRealtimeClientSecret({
      apiKey: localEnvironment.OPENAI_API_KEY,
      safetyIdentifier: createHash("sha256").update(app.getPath("userData")).digest("hex"),
    })
  )));
  ipcMain.handle(IPC.listSessions, async (): Promise<IpcResult<SessionSummary[]>> => protect(() => sessions.list()));
  ipcMain.handle(IPC.createSession, async (): Promise<IpcResult<ChatSession>> => protect(() => sessions.create()));
  ipcMain.handle(IPC.getSession, async (_event, id: unknown): Promise<IpcResult<ChatSession>> => protect(() => (
    sessions.get(requiredId(id))
  )));
  ipcMain.handle(
    IPC.appendMessage,
    async (_event, sessionId: unknown, message: unknown): Promise<IpcResult<ChatSession>> => protect(() => (
      sessions.appendMessage(requiredId(sessionId), requiredMessage(message))
    )),
  );
  ipcMain.handle(IPC.deleteSession, async (_event, id: unknown): Promise<IpcResult<SessionSummary[]>> => protect(() => (
    sessions.delete(requiredId(id))
  )));
  ipcMain.handle(IPC.getWindowMode, async (): Promise<IpcResult<WindowMode>> => protect(async () => windowMode));
  ipcMain.handle(IPC.setWindowMode, async (_event, mode: unknown): Promise<IpcResult<WindowMode>> => protect(async () => (
    setWindowMode(requiredWindowMode(mode))
  )));
  ipcMain.handle(IPC.minimizeWindow, async (): Promise<IpcResult<void>> => protect(async () => {
    mainWindow?.minimize();
  }));
  ipcMain.handle(IPC.closeWindow, async (): Promise<IpcResult<void>> => protect(async () => {
    mainWindow?.close();
  }));
  ipcMain.handle(IPC.startWakeEngine, async (): Promise<IpcResult<void>> => protect(async () => {
    wakeEngine.start();
  }));
  ipcMain.handle(
    IPC.processWakeAudio,
    async (_event, samples: unknown, sampleRate: unknown): Promise<IpcResult<boolean>> => protect(async () => {
      if (!(samples instanceof Float32Array) || samples.length > 32_768) {
        throw new Error("Local wake detection received invalid microphone audio.");
      }
      if (typeof sampleRate !== "number" || sampleRate < 8_000 || sampleRate > 192_000) {
        throw new Error("Local wake detection received an invalid sample rate.");
      }
      return wakeEngine.process(samples, sampleRate);
    }),
  );
  ipcMain.handle(IPC.stopWakeEngine, async (): Promise<IpcResult<void>> => protect(async () => {
    wakeEngine.stop();
  }));
  ipcMain.handle(IPC.controlCodex, async (_event, command: unknown): Promise<IpcResult<CodexCommandValue>> => protect(() => (
    codex.execute(requiredCodexCommand(command))
  )));
}

function createCodexCapability() {
  const capability = new CodexCapability(
    new CodexAppServerClient({
      codexBinary: findCodexBinary(),
      model: localEnvironment.BOB_CODEX_MODEL || "gpt-5.6-terra",
    }),
    {
      delegations: new DelegationWorkspace(delegationsRoot()),
      workspaces: new WorkspaceResolver(projectRoots()),
      openExternal: (url) => shell.openExternal(url),
    },
  );
  capability.onTaskUpdate((update) => {
    const window = mainWindow;
    if (window && !window.isDestroyed()) window.webContents.send(IPC.codexTaskUpdate, update);
  });
  // Connect eagerly so Bob immediately joins tasks already loaded by Desktop.
  // A failed connection remains retryable through the first explicit tool call.
  void capability.connect().catch((error) => console.warn("Bob could not preconnect to Codex:", errorMessage(error)));
  return capability;
}

function findCodexBinary() {
  if (localEnvironment.BOB_CODEX_BIN) return path.resolve(localEnvironment.BOB_CODEX_BIN);
  const home = app.getPath("home");
  const candidates = [
    path.join(home, ".local", "bin", "codex"),
    path.join(home, ".bun", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  return candidates.find(existsSync) ?? "codex";
}

function projectRoots() {
  const configured = localEnvironment.BOB_PROJECT_ROOTS;
  const roots = configured
    ? configured.split(path.delimiter).filter(Boolean)
    : [path.join(app.getPath("home"), "code")];
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function delegationsRoot() {
  return path.resolve(localEnvironment.BOB_DELEGATIONS_ROOT || path.join(app.getPath("documents"), "Bob Delegations"));
}

function setWindowMode(mode: WindowMode): WindowMode {
  const window = mainWindow;
  windowMode = mode;
  if (!window || window.isDestroyed()) return windowMode;

  if (mode === "companion") {
    window.setFullScreen(false);
    window.setMinimumSize(1, 1);
    window.setResizable(false);
    window.setFocusable(false);
    window.setSkipTaskbar(true);
    window.setHasShadow(false);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setAlwaysOnTop(true, "floating");
    window.setBounds(getCompanionBounds(), true);
    window.showInactive();
    return windowMode;
  }

  const bounds = getFullBounds();
  window.setVisibleOnAllWorkspaces(false);
  window.setAlwaysOnTop(false);
  window.setSkipTaskbar(false);
  window.setFocusable(true);
  window.setResizable(true);
  window.setHasShadow(true);
  window.setBounds(bounds, true);
  window.setMinimumSize(
    Math.min(minimumFullSize.width, bounds.width),
    Math.min(minimumFullSize.height, bounds.height),
  );
  window.show();
  window.focus();
  return windowMode;
}

function getCompanionBounds() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return {
    width: companionSize,
    height: companionSize,
    x: workArea.x + workArea.width - companionSize - companionMargin,
    y: workArea.y + Math.round((workArea.height - companionSize) / 2),
  };
}

function getFullBounds() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.min(preferredFullSize.width, workArea.width - 32);
  const height = Math.min(preferredFullSize.height, workArea.height - 32);
  return {
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
  };
}

async function protect<T>(operation: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The desktop operation failed." };
  }
}

function requiredId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 100) throw new Error("The session ID is invalid.");
  return value;
}

function requiredWindowMode(value: unknown): WindowMode {
  if (value !== "companion" && value !== "full") throw new Error("The window mode is invalid.");
  return value;
}

function requiredMessage(value: unknown): NewMessageInput {
  if (!value || typeof value !== "object") throw new Error("The message is invalid.");
  const message = value as Partial<NewMessageInput>;
  if (
    typeof message.id !== "string"
    || (message.role !== "user" && message.role !== "assistant")
    || (message.source !== "voice" && message.source !== "text")
    || typeof message.text !== "string"
    || !message.text.trim()
    || message.text.length > 100_000
    || typeof message.createdAt !== "number"
  ) {
    throw new Error("The message is invalid.");
  }
  return message as NewMessageInput;
}

function requiredCodexCommand(value: unknown): CodexCommand {
  if (!value || typeof value !== "object") throw new Error("The Codex command is invalid.");
  const command = value as Record<string, unknown>;
  if (command.type === "start") {
    return {
      type: "start",
      task: requiredShortText(command.task, "task", 100_000),
      effort: requiredEffort(command.effort),
      ...(optionalShortText(command.workspace, "workspace", 4_096) ? { workspace: optionalShortText(command.workspace, "workspace", 4_096) } : {}),
    };
  }
  if (command.type === "continue") {
    return {
      type: "continue",
      instruction: requiredShortText(command.instruction, "instruction", 100_000),
      effort: requiredEffort(command.effort),
      ...(optionalShortText(command.thread, "thread", 1_000) ? { thread: optionalShortText(command.thread, "thread", 1_000) } : {}),
    };
  }
  if (command.type === "monitor") {
    return { type: "monitor", thread: requiredShortText(command.thread, "thread", 1_000) };
  }
  if (command.type === "interrupt" || command.type === "status") {
    const thread = optionalShortText(command.thread, "thread", 1_000);
    return { type: command.type, ...(thread ? { thread } : {}) };
  }
  if (command.type === "open") {
    const reference = optionalShortText(command.reference, "reference", 4_096);
    return {
      type: "open",
      target: requiredOpenTarget(command.target),
      ...(reference ? { reference } : {}),
    };
  }
  if (command.type === "search") {
    return {
      type: "search",
      scope: requiredSearchScope(command.scope),
      query: optionalShortText(command.query, "query", 1_000) ?? "",
    };
  }
  throw new Error("The Codex command is invalid.");
}

function requiredOpenTarget(value: unknown) {
  if (value !== "app" && value !== "delegations" && value !== "project" && value !== "thread") {
    throw new Error("The Codex open target is invalid.");
  }
  return value;
}

function requiredSearchScope(value: unknown) {
  if (value !== "projects" && value !== "threads" && value !== "all") {
    throw new Error("The Codex search scope is invalid.");
  }
  return value;
}

function requiredEffort(value: unknown) {
  if (value === undefined) return "low";
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "xhigh") {
    throw new Error("The Codex reasoning effort is invalid.");
  }
  return value;
}

function requiredShortText(value: unknown, field: string, maximumLength: number) {
  const text = optionalShortText(value, field, maximumLength);
  if (!text) throw new Error(`The Codex ${field} is required.`);
  return text;
}

function optionalShortText(value: unknown, field: string, maximumLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximumLength) throw new Error(`The Codex ${field} is invalid.`);
  return value.trim() || undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
