export const BOB_CODEX_TOOLS = [
  {
    type: "function",
    name: "start_codex_task",
    description: "Start and monitor a new Codex Task in the background without opening Codex Desktop. Use this as the fallback when no other available tool can perform the user's requested action or you do not know how to perform it. General tasks go to the Bob Delegations project by default.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "A short, direct, outcome-focused instruction containing the user's requested action and necessary target details." },
        workspace: { type: "string", description: "Optional project name or absolute path. Omit for the Bob Delegations project." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: "Optional reasoning effort. Defaults to low." },
      },
      required: ["task"],
    },
  },
  {
    type: "function",
    name: "continue_codex_task",
    description: "Continue an existing Codex Task in the background, or steer it when its current turn is still running. This does not open Codex Desktop.",
    parameters: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "The new instruction for Codex." },
        thread: { type: "string", description: "Optional task title, distinctive phrase, or ID. Omit for Bob's active task." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: "Optional reasoning effort. Defaults to low." },
      },
      required: ["instruction"],
    },
  },
  {
    type: "function",
    name: "monitor_codex_task",
    description: "Subscribe Bob to an existing Codex Task so he can report its live completion and attention state.",
    parameters: {
      type: "object",
      properties: {
        thread: { type: "string", description: "Task title, distinctive phrase, or ID." },
      },
      required: ["thread"],
    },
  },
  {
    type: "function",
    name: "set_codex_live",
    description: "Turn Codex Live on for one existing Codex Task, switch it to another Task, or turn it off. While on, Bob automatically reads that Task's completed progress messages and important state changes aloud.",
    parameters: {
      type: "object",
      properties: {
        thread: { type: "string", description: "Optional task title, distinctive phrase, or ID. Omit to use Bob's active task." },
        enabled: { type: "boolean", description: "Set false to turn Codex Live off. Defaults to true." },
      },
    },
  },
  {
    type: "function",
    name: "interrupt_codex_task",
    description: "Interrupt the active turn in a Codex Task without approving any pending action.",
    parameters: {
      type: "object",
      properties: {
        thread: { type: "string", description: "Optional task title or ID. Omit for Bob's active task." },
      },
    },
  },
  {
    type: "function",
    name: "open_codex",
    description: "Open or foreground Codex Desktop at the current view, the Bob Delegations project, a named code project, or an existing task. Use only when the user explicitly asks to open, show, or foreground Codex.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["app", "delegations", "project", "thread"] },
        reference: { type: "string", description: "Project name/path or task title/ID. Required for project and thread." },
      },
      required: ["target"],
    },
  },
  {
    type: "function",
    name: "search_codex",
    description: "Search configured local code projects, recent Codex Tasks, or both before opening or delegating to a target.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Project or task name. Use an empty string to list recent/default choices." },
        scope: { type: "string", enum: ["projects", "threads", "all"] },
      },
      required: ["query", "scope"],
    },
  },
  {
    type: "function",
    name: "get_codex_task_status",
    description: "Read the latest known live state of a Codex Task.",
    parameters: {
      type: "object",
      properties: {
        thread: { type: "string", description: "Optional task title or ID. Omit for Bob's active task." },
      },
    },
  },
] as const;
