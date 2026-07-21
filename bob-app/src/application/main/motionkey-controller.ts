import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { MotionKeyCommand, MotionKeyResult } from "../../contracts/motionkey.js";

const RUN_ONCE_TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 8_000;

/**
 * Drives the MotionKey Python CLI (`python -m motionkey ...`).
 *
 * Short commands (bind/unbind/list) run to completion and return their stdout.
 * `start` spawns the long-lived webcam session and keeps a handle so `stop`
 * can end it; only one live session runs at a time.
 */
export class MotionKeyController {
  private live: ChildProcess | undefined;

  constructor(
    private readonly projectDir: string,
    private readonly python: string,
  ) {}

  async execute(command: MotionKeyCommand): Promise<MotionKeyResult> {
    if (!existsSync(this.projectDir)) {
      throw new Error(`MotionKey is not installed at ${this.projectDir}. Set BOB_MOTIONKEY_DIR.`);
    }
    switch (command.type) {
      case "start":
        return this.start(command);
      case "stop":
        return this.stop();
      case "status":
        return { output: this.live ? "A MotionKey session is running." : "No MotionKey session is running.", running: this.isLive };
      default:
        return { output: await this.runOnce(this.argv(command)), running: this.isLive };
    }
  }

  dispose() {
    this.live?.kill("SIGTERM");
    this.live = undefined;
  }

  private get isLive() {
    return Boolean(this.live);
  }

  private argv(command: MotionKeyCommand): string[] {
    switch (command.type) {
      case "bind":
        return ["bind", command.gesture, command.key, "--mode", command.mode];
      case "unbind":
        return ["unbind", command.gesture];
      case "listBindings":
        return ["bindings", "list"];
      case "listGestures":
        return ["gestures", "list"];
      default:
        throw new Error("Unsupported MotionKey command.");
    }
  }

  private start(command: { dryRun: boolean; preview: boolean }): MotionKeyResult {
    if (this.live) return { output: "A MotionKey session is already running. Stop it first.", running: true };

    const argv = ["run"];
    if (command.dryRun) argv.push("--dry-run");
    if (command.preview) argv.push("--preview");

    const child = spawn(this.python, ["-m", "motionkey", ...argv], {
      cwd: this.projectDir,
      stdio: "ignore",
    });
    child.on("error", () => {
      if (this.live === child) this.live = undefined;
    });
    child.on("exit", () => {
      if (this.live === child) this.live = undefined;
    });
    this.live = child;

    const note = command.dryRun
      ? "started in dry-run (keystrokes are logged, not sent)."
      : "started live — gestures now send real system-wide keystrokes. macOS needs Accessibility permission granted to send keys.";
    return { output: `MotionKey session ${note}`, running: true };
  }

  private stop(): MotionKeyResult {
    if (!this.live) return { output: "No MotionKey session was running.", running: false };
    this.live.kill("SIGTERM");
    this.live = undefined;
    return { output: "MotionKey session stopped.", running: false };
  }

  private runOnce(argv: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, ["-m", "motionkey", ...argv], {
        cwd: this.projectDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const append = (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("The MotionKey command timed out."));
      }, RUN_ONCE_TIMEOUT_MS);

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not run MotionKey: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const text = output.trim().slice(0, MAX_OUTPUT);
        if (code === 0) resolve(text || "Done.");
        else reject(new Error(text || `MotionKey exited with code ${code}.`));
      });
    });
  }
}

export function resolveMotionKeyPaths(appPath: string, environment: Record<string, string>) {
  const projectDir = path.resolve(environment.BOB_MOTIONKEY_DIR || path.join(appPath, "..", "motion-key"));
  const venvPython = path.join(projectDir, ".venv", "bin", "python");
  const python = environment.BOB_MOTIONKEY_PYTHON
    ? path.resolve(environment.BOB_MOTIONKEY_PYTHON)
    : existsSync(venvPython) ? venvPython : "python3";
  return { projectDir, python };
}
