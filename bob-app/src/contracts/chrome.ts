export type ChromeCommand =
  | { type: "open"; url?: string }
  | { type: "navigate"; url: string }
  | { type: "newTab"; url?: string }
  | { type: "listTabs" }
  | { type: "activateTab"; index: number }
  | { type: "closeTab"; index?: number }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" };

export interface ChromeTab {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export interface ChromeResult {
  output: string;
  tabs?: ChromeTab[];
}
