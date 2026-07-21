export const BOB_CODEX_TOOLS = [
  {
    type: "function",
    name: "start_codex_task",
    description: "Start real development work in a new Codex Task, open that same task in Codex Desktop, and monitor it live. General tasks go to the Bob Delegations project by default.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The complete task Codex should perform." },
        workspace: { type: "string", description: "Optional project name or absolute path. Omit for the Bob Delegations project." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: "Optional reasoning effort. Defaults to high." },
      },
      required: ["task"],
    },
  },
  {
    type: "function",
    name: "continue_codex_task",
    description: "Continue an existing Codex Task, or steer it when its current turn is still running.",
    parameters: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "The new instruction for Codex." },
        thread: { type: "string", description: "Optional task title, distinctive phrase, or ID. Omit for Bob's active task." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: "Optional reasoning effort. Defaults to high." },
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
    description: "Open or foreground Codex Desktop at the current view, the Bob Delegations project, a named code project, or an existing task.",
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
