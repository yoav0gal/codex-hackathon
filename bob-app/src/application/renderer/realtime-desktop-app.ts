import type { AgentEvent, AgentSession, AgentSnapshot, ConnectionMode } from "../../agent";
import type { DesktopBridge, WindowMode } from "../../contracts/ipc";
import type { ChatMessage, ChatSession, MessageRole, MessageSource, SessionSummary } from "../../contracts/sessions";
import type { WakeDetector } from "./local-wake-detector";

interface LiveMessage {
  id: string;
  role: MessageRole;
  source: MessageSource;
  text: string;
  createdAt: number;
}

type WakeSource = "emoji" | "wake-word" | "voice-button";

export class RealtimeDesktopApp {
  private activeSession: ChatSession | undefined;
  private connectedSessionId: string | undefined;
  private sessionSummaries: SessionSummary[] = [];
  private liveMessages = new Map<string, LiveMessage>();
  private persistQueue: Promise<void> = Promise.resolve();
  private isAwake = false;
  private wakeInProgress = false;
  private wakeDetectorArmed = false;
  private wakeError: string | undefined;
  private readonly narratedCodexUpdates = new Set<string>();
  private readonly elements: ReturnType<typeof mountShell>;

  constructor(
    root: HTMLElement,
    private readonly bridge: DesktopBridge,
    private readonly agent: AgentSession,
    private readonly wakeDetector: WakeDetector,
  ) {
    this.elements = mountShell(root);
    this.bindUi();
    this.agent.subscribe((event) => this.onAgentEvent(event));
    this.bridge.onCodexTaskUpdate((update) => {
      if (update.status === "inProgress") return;
      const key = `${update.turnId}:${update.status}:${update.attention?.requestId ?? ""}`;
      if (this.narratedCodexUpdates.has(key)) return;
      this.narratedCodexUpdates.add(key);
      this.agent.notifyCodexUpdate(update);
    });
  }

  async start() {
    try {
      const [mode, sessions] = await Promise.all([
        this.bridge.getWindowMode(),
        this.bridge.listSessions(),
      ]);
      this.applyWindowMode(mode);
      this.sessionSummaries = sessions;
      if (this.sessionSummaries.length === 0) {
        await this.selectSession((await this.bridge.createSession()).id);
      } else {
        await this.selectSession(this.sessionSummaries[0]!.id);
      }
      await this.armWakeDetector();
    } catch (error) {
      this.showNotice(visibleError(error), "error");
    }
  }

  private bindUi() {
    this.elements.companion.addEventListener("click", () => void this.wake("emoji"));
    this.elements.companionMode.addEventListener("click", () => void this.changeWindowMode("companion"));
    this.elements.minimizeWindow.addEventListener("click", () => void this.bridge.minimizeWindow());
    this.elements.closeWindow.addEventListener("click", () => void this.bridge.closeWindow());
    this.elements.newSession.addEventListener("click", () => void this.createSession());
    this.elements.voiceButton.addEventListener("click", () => void this.toggleVoice());
    this.elements.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.sendText();
    });
    this.elements.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.elements.composer.requestSubmit();
      }
    });
  }

  private async changeWindowMode(mode: WindowMode) {
    try {
      this.applyWindowMode(await this.bridge.setWindowMode(mode));
      if (mode === "full") this.elements.input.focus();
    } catch (error) {
      this.showNotice(visibleError(error), "error");
    }
  }

  private applyWindowMode(mode: WindowMode) {
    document.documentElement.dataset.windowMode = mode;
  }

  private async wake(source: WakeSource) {
    if (this.isAwake || this.wakeInProgress) {
      if (source === "emoji") await this.changeWindowMode("full");
      return;
    }

    this.wakeInProgress = true;
    this.isAwake = true;
    this.wakeError = undefined;
    this.renderAgentState(this.agent.snapshot());
    if (source === "emoji") await this.changeWindowMode("full");

    try {
      await this.wakeDetector.stop();
      this.wakeDetectorArmed = false;
      const session = await this.bridge.createSession();
      await this.selectSession(session.id);
      if (!await this.connect("voice")) {
        this.isAwake = false;
        await this.armWakeDetector();
      }
    } catch (error) {
      this.isAwake = false;
      this.showNotice(visibleError(error), "error");
      await this.armWakeDetector();
    } finally {
      this.wakeInProgress = false;
      this.renderAgentState(this.agent.snapshot());
    }
  }

  private async sleep() {
    this.isAwake = false;
    this.wakeInProgress = false;
    this.agent.disconnect();
    this.connectedSessionId = undefined;
    this.liveMessages.clear();
    this.renderMessages();
    await this.changeWindowMode("companion");
    await this.armWakeDetector();
  }

  private async armWakeDetector() {
    if (this.isAwake || this.wakeDetectorArmed) return;
    this.wakeDetectorArmed = true;
    this.wakeError = undefined;
    this.renderAgentState(this.agent.snapshot());
    try {
      await this.wakeDetector.start(
        () => {
          this.wakeDetectorArmed = false;
          void this.wake("wake-word");
        },
        (message) => void this.handleWakeError(message),
      );
    } catch (error) {
      this.wakeDetectorArmed = false;
      this.wakeError = visibleError(error);
      this.renderAgentState(this.agent.snapshot());
    }
  }

  private async handleWakeError(message: string) {
    this.wakeDetectorArmed = false;
    this.wakeError = message;
    await this.wakeDetector.stop();
    this.renderAgentState(this.agent.snapshot());
  }

  private async createSession() {
    try {
      const session = await this.bridge.createSession();
      await this.selectSession(session.id);
      this.elements.input.focus();
    } catch (error) {
      this.showNotice(visibleError(error), "error");
    }
  }

  private async selectSession(id: string) {
    this.agent.disconnect();
    this.connectedSessionId = undefined;
    this.liveMessages.clear();
    this.activeSession = await this.bridge.getSession(id);
    this.sessionSummaries = await this.bridge.listSessions();
    this.render();
  }

  private async deleteSession(id: string) {
    try {
      const deletingActive = this.activeSession?.id === id;
      this.sessionSummaries = await this.bridge.deleteSession(id);
      if (!deletingActive) {
        this.renderSessionList();
        return;
      }
      this.agent.disconnect();
      this.connectedSessionId = undefined;
      const next = this.sessionSummaries[0] ?? summarize(await this.bridge.createSession());
      await this.selectSession(next.id);
    } catch (error) {
      this.showNotice(visibleError(error), "error");
    }
  }

  private async toggleVoice() {
    const snapshot = this.agent.snapshot();
    if (snapshot.mode === "voice" && snapshot.status !== "disconnected" && snapshot.status !== "error") {
      await this.sleep();
      return;
    }
    await this.wake("voice-button");
  }

  private async connect(mode: ConnectionMode) {
    const session = this.activeSession;
    if (!session) return false;
    this.liveMessages.clear();
    try {
      if (!this.isAwake) {
        this.isAwake = true;
        await this.wakeDetector.stop();
        this.wakeDetectorArmed = false;
      }
      await this.agent.connect({ history: session.messages, mode });
      this.connectedSessionId = session.id;
      this.showNotice(mode === "voice" ? "Voice is live. You can speak or type." : "Connected for text.", "success");
      return true;
    } catch (error) {
      this.connectedSessionId = undefined;
      this.showNotice(visibleError(error), "error");
      return false;
    }
  }

  private async sendText() {
    const text = this.elements.input.value.trim();
    if (!text || !this.activeSession) return;
    this.elements.input.value = "";
    this.resizeInput();

    try {
      const snapshot = this.agent.snapshot();
      if (
        this.connectedSessionId !== this.activeSession.id
        || snapshot.status === "disconnected"
        || snapshot.status === "error"
      ) {
        await this.connect("text");
      }
      this.agent.sendText(text);
    } catch (error) {
      this.elements.input.value = text;
      this.showNotice(visibleError(error), "error");
    }
  }

  private onAgentEvent(event: AgentEvent) {
    if (event.type === "state") {
      this.renderAgentState(event.snapshot);
      return;
    }

    const message = event.message;
    const previous = this.liveMessages.get(message.id);
    const text = message.final ? message.text : `${previous?.text ?? ""}${message.text}`;
    if (message.final) this.liveMessages.delete(message.id);
    else this.liveMessages.set(message.id, { ...message, text });
    this.renderMessages();

    if (message.final && message.text.trim() && this.connectedSessionId) {
      const sessionId = this.connectedSessionId;
      this.persistQueue = this.persistQueue.then(async () => {
        const session = await this.bridge.appendMessage(sessionId, {
          id: message.id,
          role: message.role,
          source: message.source,
          text: message.text,
          createdAt: message.createdAt,
        });
        if (this.activeSession?.id === sessionId) {
          this.activeSession = session;
          this.sessionSummaries = await this.bridge.listSessions();
          this.render();
        }
      }).catch((error) => this.showNotice(visibleError(error), "error"));
    }

    if (
      message.final
      && message.role === "user"
      && message.source === "voice"
      && isSleepCommand(message.text)
    ) {
      void this.sleep();
    }
  }

  private render() {
    this.elements.sessionTitle.textContent = this.activeSession?.title ?? "Bob";
    this.renderSessionList();
    this.renderMessages();
    this.renderAgentState(this.agent.snapshot());
  }

  private renderSessionList() {
    this.elements.sessions.replaceChildren(...this.sessionSummaries.map((session) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const title = document.createElement("strong");
      const meta = document.createElement("span");
      const remove = document.createElement("button");

      item.className = "session-row";
      item.classList.toggle("active", session.id === this.activeSession?.id);
      button.className = "session-select";
      button.type = "button";
      title.textContent = session.title;
      meta.textContent = `${session.messageCount} ${session.messageCount === 1 ? "message" : "messages"} · ${relativeTime(session.updatedAt)}`;
      button.append(title, meta);
      button.addEventListener("click", () => void this.selectSession(session.id));

      remove.className = "session-delete";
      remove.type = "button";
      remove.ariaLabel = `Delete ${session.title}`;
      remove.textContent = "×";
      remove.addEventListener("click", () => void this.deleteSession(session.id));
      item.append(button, remove);
      return item;
    }));
  }

  private renderMessages() {
    const persisted = this.activeSession?.messages ?? [];
    const live = [...this.liveMessages.values()];
    const messages = [...persisted, ...live].sort((left, right) => left.createdAt - right.createdAt);
    this.elements.empty.hidden = messages.length > 0;
    this.elements.messages.replaceChildren(...messages.map((message) => messageElement(
      message,
      this.liveMessages.has(message.id),
    )));
    this.elements.transcript.scrollTop = this.elements.transcript.scrollHeight;
  }

  private renderAgentState(snapshot: AgentSnapshot) {
    const sleeping = !this.isAwake && snapshot.status === "disconnected";
    const presentation = sleeping
      ? {
          label: this.wakeError ? "Click to wake" : "Sleeping",
          description: this.wakeError ?? "Say “Hey, Bob” or click the face to start a new voice session.",
        }
      : this.wakeInProgress && snapshot.status === "disconnected"
        ? { label: "Waking", description: "Starting a fresh voice session…" }
        : statusPresentation(snapshot);
    const visualStatus = sleeping ? (this.wakeError ? "error" : "sleeping") : snapshot.status;
    this.elements.statusLabel.textContent = presentation.label;
    this.elements.statusDot.dataset.status = visualStatus;
    this.elements.statusDescription.textContent = snapshot.error ?? presentation.description;
    const voiceActive = snapshot.mode === "voice" && !["disconnected", "error"].includes(snapshot.status);
    this.elements.voiceButton.classList.toggle("active", voiceActive);
    this.elements.voiceButton.textContent = voiceActive ? "Go to sleep" : sleeping ? "Wake Bob" : "Start voice";
    this.elements.voiceButton.disabled = snapshot.status === "connecting";
    this.elements.sendButton.disabled = snapshot.status === "connecting";
    this.elements.companion.dataset.status = visualStatus;
    this.elements.companionStatus.textContent = presentation.label;
    this.elements.companion.ariaLabel = sleeping
      ? `Bob is ${presentation.label.toLowerCase()}. Click to wake him.`
      : `Open Bob — ${presentation.label}`;
    this.elements.companion.title = sleeping
      ? `${presentation.label}. Say “Hey, Bob” or click to wake.`
      : `${presentation.label}. Click to open Bob.`;
  }

  private showNotice(message: string, kind: "success" | "error") {
    this.elements.notice.textContent = message;
    this.elements.notice.dataset.kind = kind;
    this.elements.notice.hidden = false;
    window.setTimeout(() => {
      if (this.elements.notice.textContent === message) this.elements.notice.hidden = true;
    }, 4_000);
  }

  private resizeInput() {
    this.elements.input.style.height = "auto";
    this.elements.input.style.height = `${Math.min(this.elements.input.scrollHeight, 140)}px`;
  }
}

function mountShell(root: HTMLElement) {
  root.innerHTML = `
    <button class="companion" type="button" data-status="sleeping" aria-label="Bob is sleeping. Click to wake him.">
      <span class="companion-halo" aria-hidden="true"></span>
      <span class="companion-face" aria-hidden="true">
        <i class="companion-eye eye-left"></i>
        <i class="companion-eye eye-right"></i>
        <i class="companion-mouth"></i>
      </span>
      <span class="companion-state"><i aria-hidden="true"></i><span>Sleeping</span></span>
    </button>
    <main class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"><span></span></div>
          <div><strong>Bob</strong><span>OpenAI voice + text</span></div>
        </div>
        <button class="new-session" type="button"><span>＋</span> New session</button>
        <p class="section-label">Sessions</p>
        <ol class="session-list" aria-label="Saved sessions"></ol>
        <div class="privacy-note">
          <span aria-hidden="true">⌁</span>
          <p><strong>Private wake word</strong>“Hey, Bob” stays on this Mac while Bob sleeps.</p>
        </div>
      </aside>
      <section class="conversation">
        <header class="topbar">
          <div>
            <h1>New session</h1>
            <div class="connection-status"><i data-status="disconnected"></i><span>Offline</span></div>
          </div>
          <div class="topbar-actions">
            <button class="voice-button" type="button"><span class="voice-glyph" aria-hidden="true"></span>Start voice</button>
            <button class="companion-mode-button" type="button" title="Keep the agent at the side of your screen">
              <span class="mini-face" aria-hidden="true">⌣</span> Companion mode
            </button>
            <span class="window-actions" aria-label="Window controls">
              <button class="window-minimize" type="button" aria-label="Minimize">−</button>
              <button class="window-close" type="button" aria-label="Close">×</button>
            </span>
          </div>
        </header>
        <div class="status-strip"><span>Ready when you are.</span></div>
        <div class="notice" hidden></div>
        <section class="transcript" aria-label="Conversation transcript">
          <div class="empty-state">
            <div class="orb" aria-hidden="true"><span></span></div>
            <h2>Talk or type</h2>
            <p>Start voice for a live conversation, or send a message below. Your session will be saved automatically.</p>
          </div>
          <ol class="message-list" aria-live="polite"></ol>
        </section>
        <form class="composer">
          <textarea rows="1" placeholder="Message the realtime agent…" aria-label="Message"></textarea>
          <div class="composer-actions">
            <span><kbd>↵</kbd> send · <kbd>⇧↵</kbd> new line</span>
            <button type="submit" aria-label="Send message">↑</button>
          </div>
        </form>
      </section>
    </main>`;

  const input = required<HTMLTextAreaElement>(root, "textarea");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  return {
    companion: required<HTMLButtonElement>(root, ".companion"),
    companionStatus: required<HTMLElement>(root, ".companion-state span"),
    companionMode: required<HTMLButtonElement>(root, ".companion-mode-button"),
    minimizeWindow: required<HTMLButtonElement>(root, ".window-minimize"),
    closeWindow: required<HTMLButtonElement>(root, ".window-close"),
    newSession: required<HTMLButtonElement>(root, ".new-session"),
    sessions: required<HTMLOListElement>(root, ".session-list"),
    sessionTitle: required<HTMLHeadingElement>(root, "h1"),
    voiceButton: required<HTMLButtonElement>(root, ".voice-button"),
    statusDot: required<HTMLElement>(root, ".connection-status i"),
    statusLabel: required<HTMLElement>(root, ".connection-status span"),
    statusDescription: required<HTMLElement>(root, ".status-strip span"),
    notice: required<HTMLElement>(root, ".notice"),
    transcript: required<HTMLElement>(root, ".transcript"),
    empty: required<HTMLElement>(root, ".empty-state"),
    messages: required<HTMLOListElement>(root, ".message-list"),
    composer: required<HTMLFormElement>(root, ".composer"),
    input,
    sendButton: required<HTMLButtonElement>(root, ".composer button[type=submit]"),
  };
}

function messageElement(message: ChatMessage | LiveMessage, provisional: boolean) {
  const item = document.createElement("li");
  const meta = document.createElement("div");
  const body = document.createElement("p");
  const role = document.createElement("strong");
  const source = document.createElement("span");

  item.className = `message ${message.role}${provisional ? " provisional" : ""}`;
  role.textContent = message.role === "user" ? "You" : "Bob";
  source.textContent = `${message.source === "voice" ? "Voice" : "Text"} · ${timeOfDay(message.createdAt)}`;
  meta.append(role, source);
  body.textContent = message.text || "Listening…";
  item.append(meta, body);
  return item;
}

function statusPresentation(snapshot: AgentSnapshot) {
  const values = {
    disconnected: { label: "Offline", description: "Start voice or send a message to connect." },
    connecting: { label: "Connecting", description: "Opening a secure Realtime session…" },
    ready: { label: "Text ready", description: "Connected. Send another message or start voice." },
    listening: { label: "Listening", description: "Voice is live. Speak naturally or type." },
    thinking: { label: "Thinking", description: "The agent is preparing a response…" },
    speaking: { label: "Speaking", description: "The agent is responding. You can interrupt by speaking." },
    error: { label: "Needs attention", description: "The Realtime session failed." },
  } as const;
  return values[snapshot.status];
}

function summarize(session: ChatSession): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

function required<T extends Element>(root: ParentNode, selector: string) {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing application element: ${selector}`);
  return element;
}

function relativeTime(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function timeOfDay(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function visibleError(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function isSleepCommand(text: string) {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    "go to sleep",
    "go to sleep bob",
    "bob go to sleep",
    "please go to sleep",
    "go to sleep please",
  ].includes(normalized);
}
