import type { ChatMessage, MessageRole, MessageSource } from "../contracts/sessions";
import type { CodexTaskUpdate } from "../contracts/codex";

export type AgentStatus = "disconnected" | "connecting" | "ready" | "listening" | "thinking" | "speaking" | "error";
export type ConnectionMode = "text" | "voice";

export interface AgentSnapshot {
  status: AgentStatus;
  mode?: ConnectionMode;
  error?: string;
}

export type AgentEvent =
  | { type: "state"; snapshot: AgentSnapshot }
  | {
      type: "message";
      message: {
        id: string;
        role: MessageRole;
        source: MessageSource;
        text: string;
        final: boolean;
        createdAt: number;
      };
    };

export interface ConnectOptions {
  history: readonly ChatMessage[];
  mode: ConnectionMode;
}

export interface AgentSession {
  connect(options: ConnectOptions): Promise<void>;
  disconnect(): void;
  sendText(text: string): void;
  notifyCodexUpdate(update: CodexTaskUpdate): void;
  snapshot(): AgentSnapshot;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
