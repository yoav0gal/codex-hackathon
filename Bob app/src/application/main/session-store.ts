import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, ChatSession, NewMessageInput, SessionSummary } from "../../contracts/sessions.js";

interface SessionFile {
  version: 1;
  sessions: ChatSession[];
}

export class SessionStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<SessionSummary[]> {
    const file = await this.read();
    return file.sessions
      .map(({ id, title, updatedAt, messages }) => ({ id, title, updatedAt, messageCount: messages.length }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async create(): Promise<ChatSession> {
    const now = Date.now();
    const session: ChatSession = {
      id: randomUUID(),
      title: "New session",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.update((file) => ({ ...file, sessions: [session, ...file.sessions] }));
    return structuredClone(session);
  }

  async get(id: string): Promise<ChatSession> {
    const session = (await this.read()).sessions.find((candidate) => candidate.id === id);
    if (!session) throw new Error("That session no longer exists.");
    return structuredClone(session);
  }

  async appendMessage(sessionId: string, input: NewMessageInput): Promise<ChatSession> {
    let updated: ChatSession | undefined;
    await this.update((file) => ({
      ...file,
      sessions: file.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const message = normalizeMessage(input);
        const messages = [...session.messages.filter((candidate) => candidate.id !== message.id), message];
        updated = {
          ...session,
          title: session.title === "New session" && message.role === "user"
            ? titleFrom(message.text)
            : session.title,
          updatedAt: Math.max(Date.now(), message.createdAt),
          messages,
        };
        return updated;
      }),
    }));
    if (!updated) throw new Error("That session no longer exists.");
    return structuredClone(updated);
  }

  async delete(id: string): Promise<SessionSummary[]> {
    await this.update((file) => ({ ...file, sessions: file.sessions.filter((session) => session.id !== id) }));
    return this.list();
  }

  private async update(transform: (file: SessionFile) => SessionFile) {
    let operationError: unknown;
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await this.write(transform(await this.read()));
      } catch (error) {
        operationError = error;
      }
    });
    await this.writeQueue;
    if (operationError) throw operationError;
  }

  private async read(): Promise<SessionFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return normalizeFile(parsed);
    } catch (error) {
      if (isMissingFile(error)) return { version: 1, sessions: [] };
      throw new Error("Saved sessions could not be read.", { cause: error });
    }
  }

  private async write(file: SessionFile) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

function normalizeFile(value: unknown): SessionFile {
  if (!value || typeof value !== "object" || !Array.isArray((value as Partial<SessionFile>).sessions)) {
    throw new Error("The saved session file is invalid.");
  }
  return {
    version: 1,
    sessions: (value as Partial<SessionFile>).sessions!.map(normalizeSession),
  };
}

function normalizeSession(value: unknown): ChatSession {
  if (!value || typeof value !== "object") throw new Error("A saved session is invalid.");
  const session = value as Partial<ChatSession>;
  if (
    typeof session.id !== "string"
    || typeof session.title !== "string"
    || typeof session.createdAt !== "number"
    || typeof session.updatedAt !== "number"
    || !Array.isArray(session.messages)
  ) {
    throw new Error("A saved session is invalid.");
  }
  return { ...session, messages: session.messages.map(normalizeMessage) } as ChatSession;
}

function normalizeMessage(value: unknown): ChatMessage {
  if (!value || typeof value !== "object") throw new Error("A saved message is invalid.");
  const message = value as Partial<ChatMessage>;
  if (
    typeof message.id !== "string"
    || (message.role !== "user" && message.role !== "assistant")
    || (message.source !== "voice" && message.source !== "text")
    || typeof message.text !== "string"
    || !message.text.trim()
    || typeof message.createdAt !== "number"
  ) {
    throw new Error("A saved message is invalid.");
  }
  return { ...message, text: sanitizeText(message.text) } as ChatMessage;
}

function titleFrom(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 41).trimEnd()}…` : compact;
}

function sanitizeText(text: string) {
  return text
    .replace(/\bBearer\s+\S*/gi, "[redacted]")
    .replace(/\b(?:sk|ek)_[A-Za-z0-9_-]*/gi, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]*/gi, "[redacted]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
