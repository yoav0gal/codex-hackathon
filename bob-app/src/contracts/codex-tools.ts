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
    name: "open_codex_task",
    description: "Open Codex Desktop at a task, or open the default Codex project view when no task is provided.",
    parameters: {
      type: "object",
      properties: {
        thread: { type: "string", description: "Optional task title, distinctive phrase, or ID." },
      },
    },
  },
  {
    type: "function",
    name: "search_codex_tasks",
    description: "Search recent Codex Tasks by title or message preview before opening, monitoring, or continuing one.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text. Use an empty string to list recent tasks." },
      },
      required: ["query"],
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
