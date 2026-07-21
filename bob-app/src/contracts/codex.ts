export type CodexEffort = "low" | "medium" | "high" | "xhigh";

export type CodexCommand =
  | {
      type: "start";
      task: string;
      workspace?: string;
      effort: CodexEffort;
    }
  | {
      type: "continue";
      instruction: string;
      thread?: string;
      effort: CodexEffort;
    }
  | {
      type: "monitor";
      thread: string;
    }
  | {
      type: "interrupt";
      thread?: string;
    }
  | {
      type: "open";
      thread?: string;
    }
  | {
      type: "search";
      query: string;
    }
  | {
      type: "status";
      thread?: string;
    };

export type CodexTurnStatus =
  | "inProgress"
  | "needsAttention"
  | "completed"
  | "failed"
  | "interrupted";

export interface CodexThreadSummary {
  id: string;
  title: string;
  preview: string;
  workspace: string;
  updatedAt: number;
}

export interface CodexTaskUpdate {
  threadId: string;
  turnId: string;
  status: CodexTurnStatus;
  assistantText: string;
  error?: string;
  attention?: {
    method: string;
    requestId: string | number;
  };
}

export interface CodexCommandValue {
  message: string;
  threadId?: string;
  turnId?: string;
  workspace?: string;
  connectionMode?: "shared";
  serverVersion?: string;
  task?: CodexTaskUpdate;
  threads?: CodexThreadSummary[];
}
