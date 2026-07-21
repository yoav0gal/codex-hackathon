import type { DesktopBridge } from "../contracts/ipc";

declare global {
  interface Window {
    realtimeApp: DesktopBridge;
  }
}

export {};
