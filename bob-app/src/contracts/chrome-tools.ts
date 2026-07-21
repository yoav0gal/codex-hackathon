export const BOB_CHROME_TOOLS = [
  {
    type: "function",
    name: "control_chrome",
    description: "Open and control Google Chrome on this Mac. It can open Chrome, navigate the active tab, create, list, activate, or close tabs, and go back, forward, or reload. Tab indexes come from list_tabs and start at 1.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open", "navigate", "new_tab", "list_tabs", "activate_tab", "close_tab", "back", "forward", "reload"],
          description: "The Chrome action to perform.",
        },
        url: {
          type: "string",
          description: "Web address for open, navigate, or new_tab. If omitted from open, only foreground Chrome; if omitted from new_tab, create a blank tab.",
        },
        tab_index: {
          type: "number",
          description: "One-based tab index from list_tabs. Required for activate_tab; optional for close_tab, which otherwise closes the active tab.",
        },
      },
      required: ["action"],
    },
  },
] as const;
