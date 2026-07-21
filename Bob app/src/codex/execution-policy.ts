/** Bob delegates autonomously by default: no approval prompts and no sandbox. */
export const BOB_THREAD_EXECUTION_POLICY = {
  approvalPolicy: "never",
  sandbox: "danger-full-access",
} as const;

/** turn/start uses the expanded sandbox-policy shape rather than SandboxMode. */
export const BOB_TURN_EXECUTION_POLICY = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" },
} as const;
