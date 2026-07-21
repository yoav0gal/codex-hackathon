import "./styles.css";
import { executeCodexTool, executeMotionKeyTool, OpenAIRealtimeAgent } from "../../agent";
import { RealtimeDesktopApp } from "./realtime-desktop-app";
import { LocalWakeDetector } from "./local-wake-detector";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("The application root is missing.");

const agent = new OpenAIRealtimeAgent({
  getClientSecret: () => window.realtimeApp.getRealtimeClientSecret(),
  executeTool: (name, arguments_) => (name === "control_motionkey"
    ? executeMotionKeyTool(name, arguments_, window.realtimeApp)
    : executeCodexTool(name, arguments_, window.realtimeApp)),
});
const wakeDetector = new LocalWakeDetector(window.realtimeApp);

const application = new RealtimeDesktopApp(root, window.realtimeApp, agent, wakeDetector);
void application.start();
