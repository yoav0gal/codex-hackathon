export type ChromeCommand =
  | { type: "open"; url?: string }
  | { type: "navigate"; url: string }
  | { type: "newTab"; url: string };

export interface ChromeCommandValue {
  action: "opened" | "navigated" | "newTab";
  url?: string;
}
