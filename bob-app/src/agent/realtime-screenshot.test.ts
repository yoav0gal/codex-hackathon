import { describe, expect, it } from "vitest";
import { realtimeToolResultEvents } from "./realtime-agent";

describe("Realtime screenshot tool results", () => {
  it("adds the captured image directly to the Realtime conversation", () => {
    const events = realtimeToolResultEvents("call-screen", {
      output: { ok: true, width: 1280, height: 800 },
      screenshot: {
        dataUrl: "data:image/jpeg;base64,c2NyZWVu",
        displayId: "1",
        width: 1280,
        height: 800,
      },
    });

    expect(events).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call-screen",
          output: JSON.stringify({ ok: true, width: 1280, height: 800 }),
        },
      },
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "This is the current display captured by your take_screenshot tool. Use it as the user's current visual context.",
            },
            { type: "input_image", image_url: "data:image/jpeg;base64,c2NyZWVu" },
          ],
        },
      },
    ]);
  });

  it("does not add an image when screen capture fails", () => {
    const events = realtimeToolResultEvents("call-screen", {
      output: { ok: false, error: "Screen capture is blocked." },
    });

    expect(events).toEqual([{
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call-screen",
        output: JSON.stringify({ ok: false, error: "Screen capture is blocked." }),
      },
    }]);
  });
});
