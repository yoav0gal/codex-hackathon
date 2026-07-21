import "./styles.css";
import { executeChromeTool, executeCodexTool, executeMotionKeyTool, OpenAIRealtimeAgent } from "../../agent";
import { RealtimeDesktopApp } from "./realtime-desktop-app";
import { LocalWakeDetector } from "./local-wake-detector";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("The application root is missing.");

const agent = new OpenAIRealtimeAgent({
  getClientSecret: () => window.realtimeApp.getRealtimeClientSecret(),
  executeTool: (name, arguments_) => {
    if (name === "control_motionkey") return executeMotionKeyTool(name, arguments_, window.realtimeApp);
    if (name === "control_chrome") return executeChromeTool(name, arguments_, window.realtimeApp);
    return executeCodexTool(name, arguments_, window.realtimeApp);
  },
});
const wakeDetector = new LocalWakeDetector(window.realtimeApp);

const application = new RealtimeDesktopApp(root, window.realtimeApp, agent, wakeDetector);
void application.start();
