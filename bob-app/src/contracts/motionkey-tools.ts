export const BOB_MOTIONKEY_TOOLS = [
  {
    type: "function",
    name: "control_motionkey",
    description:
      "Control MotionKey, the local webcam hand-gesture keyboard controller. Bind or unbind gestures to keys, list the gesture bank or current bindings, and start or stop the live session that turns gestures into system-wide keystrokes.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["bind", "unbind", "list_bindings", "list_gestures", "start", "stop", "status"],
          description: "What to do. bind/unbind edit a gesture->key mapping; start/stop control the live camera session.",
        },
        gesture: {
          type: "string",
          description: "Gesture name, e.g. left-fist, right-fist, both-fists, raise-left-hand, joystick-right. Required for bind and unbind.",
        },
        key: {
          type: "string",
          description: "Target key: a-z, 0-9, arrows (left/right/up/down), space, enter, escape, tab, backspace. Required for bind.",
        },
        mode: {
          type: "string",
          enum: ["hold", "tap"],
          description: "hold keeps the key down while the gesture is active; tap presses once per activation. Defaults to hold.",
        },
        dry_run: {
          type: "boolean",
          description: "For start: log intended keystrokes without actually sending them. Prefer this when the user just wants to test.",
        },
        preview: {
          type: "boolean",
          description: "For start: open the OpenCV camera preview window.",
        },
      },
      required: ["action"],
    },
  },
] as const;
