export type MessageRole = "user" | "assistant";
export type MessageSource = "voice" | "text";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  source: MessageSource;
  text: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface NewMessageInput {
  id: string;
  role: MessageRole;
  source: MessageSource;
  text: string;
  createdAt: number;
}
