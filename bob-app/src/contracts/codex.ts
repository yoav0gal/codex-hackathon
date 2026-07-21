export type CodexEffort = "low" | "medium" | "high" | "xhigh";
export type CodexOpenTarget = "app" | "delegations" | "project" | "thread";
export type CodexSearchScope = "projects" | "threads" | "all";
export type CodexUpdateEvent =
  | "snapshot"
  | "turnStarted"
  | "agentMessage"
  | "delta"
  | "attention"
  | "attentionResolved"
  | "error"
  | "turnCompleted";

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
      type: "live";
      enabled: boolean;
      thread?: string;
    }
  | {
      type: "interrupt";
      thread?: string;
    }
  | {
      type: "open";
      target: CodexOpenTarget;
      reference?: string;
    }
  | {
      type: "search";
      scope: CodexSearchScope;
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
  event?: CodexUpdateEvent;
  eventId?: string;
  updateText?: string;
  live?: boolean;
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
  codexLive?: boolean;
  task?: CodexTaskUpdate;
  projects?: string[];
  threads?: CodexThreadSummary[];
}
