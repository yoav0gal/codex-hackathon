import { describe, expect, it } from "vitest";
import { computerCommand } from "./computer-tool-router";

describe("computer tool routing", () => {
  it("maps visual and input actions to constrained desktop commands", () => {
    expect(computerCommand({ action: "see" })).toEqual({ type: "see", display: 0 });
    expect(computerCommand({ action: "click", x: 500, y: 250, count: 2 })).toEqual({
      type: "click", display: 0, x: 500, y: 250, button: "left", count: 2,
    });
    expect(computerCommand({ action: "key", keys: "cmd+l" })).toEqual({ type: "key", keys: "cmd+l" });
  });

  it("rejects coordinates outside the normalized display", () => {
    expect(() => computerCommand({ action: "click", x: 1001, y: 10 })).toThrow("invalid x");
  });
});
