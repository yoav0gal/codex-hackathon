import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { screen } from "electron";
import type { ComputerCommand, ComputerCommandValue } from "../../contracts/computer.js";

const executeFile = promisify(execFile);

/** Explicit desktop actions backed by macOS Accessibility and screen-capture APIs. */
export class ComputerCapability {
  async execute(command: ComputerCommand): Promise<ComputerCommandValue> {
    if (process.platform !== "darwin") {
      throw new Error("Desktop control is currently available on macOS only.");
    }
    if (command.type === "see") return this.capture(command.display);
    if (command.type === "type") {
      await runJxa("type", command.text);
      return { action: "typed" };
    }
    if (command.type === "key") {
      await runJxa("key", command.keys);
      return { action: "keyPressed" };
    }

    const display = displayAt(command.display);
    if (command.type === "click") {
      const point = pointAt(display.bounds, command.x, command.y);
      await runJxa("click", String(point.x), String(point.y), command.button, String(command.count));
      return { action: "clicked" };
    }
    if (command.type === "drag") {
      const from = pointAt(display.bounds, command.fromX, command.fromY);
      const to = pointAt(display.bounds, command.toX, command.toY);
      await runJxa("drag", String(from.x), String(from.y), String(to.x), String(to.y));
      return { action: "dragged" };
    }
    const point = pointAt(display.bounds, command.x, command.y);
    await runJxa("scroll", String(point.x), String(point.y), String(command.deltaX), String(command.deltaY));
    return { action: "scrolled" };
  }

  private async capture(display: number): Promise<ComputerCommandValue> {
    displayAt(display);
    const directory = await mkdtemp(path.join(tmpdir(), "bob-screen-"));
    const screenshotPath = path.join(directory, "screen.jpg");
    try {
      await executeFile("screencapture", ["-x", "-t", "jpg", "-D", String(display + 1), screenshotPath]);
      const image = await readFile(screenshotPath);
      return {
        action: "screenCaptured",
        screen: { imageDataUrl: `data:image/jpeg;base64,${image.toString("base64")}`, display },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function displayAt(index: number) {
  const display = screen.getAllDisplays()[index];
  if (!display) throw new Error(`Display ${index + 1} is not available.`);
  return display;
}

function pointAt(bounds: Electron.Rectangle, x: number, y: number) {
  return {
    x: Math.round(bounds.x + (bounds.width * x) / 1000),
    y: Math.round(bounds.y + (bounds.height * y) / 1000),
  };
}

async function runJxa(...arguments_: string[]) {
  await executeFile("osascript", ["-l", "JavaScript", "-e", jxaScript, ...arguments_]);
}

const jxaScript = `ObjC.import('ApplicationServices');
const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).slice(5);
const code = { return: 36, enter: 76, tab: 48, escape: 53, space: 49, delete: 51, backspace: 51, up: 126, down: 125, left: 123, right: 124, home: 115, end: 119, pageup: 116, pagedown: 121, a: 0, b: 11, c: 8, d: 2, e: 14, f: 3, g: 5, h: 4, i: 34, j: 38, k: 40, l: 37, m: 46, n: 45, o: 31, p: 35, q: 12, r: 15, s: 1, t: 17, u: 32, v: 9, w: 13, x: 7, y: 16, z: 6, '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25 };
const modifiers = { cmd: 55, command: 55, ctrl: 59, control: 59, option: 58, alt: 58, shift: 56 };
function post(type, point, button) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, point, button)); }
function point(x, y) { return $.CGPointMake(Number(x), Number(y)); }
function key(codeValue, down) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateKeyboardEvent(null, codeValue, down)); }
function click(x, y, button, count) { const p = point(x, y); const b = button === 'right' ? $.kCGMouseButtonRight : $.kCGMouseButtonLeft; const down = button === 'right' ? $.kCGEventRightMouseDown : $.kCGEventLeftMouseDown; const up = button === 'right' ? $.kCGEventRightMouseUp : $.kCGEventLeftMouseUp; for (let i = 0; i < Number(count); i++) { post(down, p, b); post(up, p, b); } }
function type(text) { const event = $.CGEventCreateKeyboardEvent(null, 0, true); $.CGEventKeyboardSetUnicodeString(event, text.length, text); $.CGEventPost($.kCGHIDEventTap, event); }
function shortcut(value) { const parts = value.toLowerCase().split('+').map(part => part.trim()).filter(Boolean); const target = parts.pop(); if (!target || code[target] === undefined) throw new Error('Unsupported key: ' + value); const held = parts.map(part => modifiers[part]).filter(keyCode => keyCode !== undefined); if (held.length !== parts.length) throw new Error('Unsupported modifier in: ' + value); held.forEach(keyCode => key(keyCode, true)); key(code[target], true); key(code[target], false); held.reverse().forEach(keyCode => key(keyCode, false)); }
switch (args[0]) { case 'click': click(args[1], args[2], args[3], args[4]); break; case 'drag': { const from = point(args[1], args[2]); const to = point(args[3], args[4]); post($.kCGEventLeftMouseDown, from, $.kCGMouseButtonLeft); post($.kCGEventLeftMouseDragged, to, $.kCGMouseButtonLeft); post($.kCGEventLeftMouseUp, to, $.kCGMouseButtonLeft); break; } case 'scroll': { const event = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, Number(args[4]), Number(args[3])); $.CGEventSetLocation(event, point(args[1], args[2])); $.CGEventPost($.kCGHIDEventTap, event); break; } case 'type': type(args[1]); break; case 'key': shortcut(args[1]); break; default: throw new Error('Unsupported desktop action.'); }`;
