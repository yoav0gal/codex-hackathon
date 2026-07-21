export type MotionKeyGestureMode = "hold" | "tap";

export type MotionKeyCommand =
  | { type: "bind"; gesture: string; key: string; mode: MotionKeyGestureMode }
  | { type: "unbind"; gesture: string }
  | { type: "listBindings" }
  | { type: "listGestures" }
  | { type: "start"; dryRun: boolean; preview: boolean }
  | { type: "stop" }
  | { type: "status" };

export interface MotionKeyResult {
  /** Human-readable CLI output (trimmed) for Bob to relay. */
  output: string;
  /** Whether a live gesture session is running after the command. */
  running: boolean;
}
