export type ComputerCommand =
  | { type: "see"; display: number }
  | { type: "click"; display: number; x: number; y: number; button: "left" | "right"; count: 1 | 2 }
  | { type: "drag"; display: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "scroll"; display: number; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "type"; text: string }
  | { type: "key"; keys: string };

export interface ScreenCapture {
  imageDataUrl: string;
  display: number;
}

export type ComputerCommandValue =
  | { action: "screenCaptured"; screen: ScreenCapture }
  | { action: "clicked" | "dragged" | "scrolled" | "typed" | "keyPressed" };
