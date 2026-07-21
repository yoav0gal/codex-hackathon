export const BOB_SCREENSHOT_TOOLS = [
  {
    type: "function",
    name: "take_screenshot",
    description:
      "Capture the display the user is currently looking at and add the image directly to this Realtime conversation. Use it when the user asks what is on screen or when current visual context is needed. Do not delegate screen capture to Codex.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;
