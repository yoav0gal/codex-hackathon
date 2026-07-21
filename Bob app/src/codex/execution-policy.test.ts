import { describe, expect, it } from "vitest";
import { BOB_THREAD_EXECUTION_POLICY, BOB_TURN_EXECUTION_POLICY } from "./execution-policy.js";

describe("Bob delegation execution policy", () => {
  it("runs new and resumed tasks without approvals or a sandbox", () => {
    expect(BOB_THREAD_EXECUTION_POLICY).toEqual({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
  });

  it("keeps every new turn in YOLO mode", () => {
    expect(BOB_TURN_EXECUTION_POLICY).toEqual({
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
  });
});
