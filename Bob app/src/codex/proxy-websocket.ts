import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * WebSocket framing for `codex app-server proxy`.
 *
 * The proxy is a raw stdio tunnel to the managed Unix socket, so the client
 * still performs the HTTP upgrade and WebSocket framing. Keeping that detail
 * here prevents JSON-RPC callers from knowing anything about the transport.
 */
export class ProxyWebSocket {
  private buffer = Buffer.alloc(0);
  private readonly key = randomBytes(16).toString("base64");
  private opened = false;
  private opening: Promise<void> | undefined;
  private resolveOpening: (() => void) | undefined;
  private rejectOpening: ((error: Error) => void) | undefined;
  private openingTimeout: ReturnType<typeof setTimeout> | undefined;
  private fragments: Buffer[] = [];
  private fragmentOpcode: number | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly onMessage: (message: string) => void,
  ) {
    child.stdout.on("data", (chunk) => this.receiveBytes(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.once("error", (error) => this.fail(new Error(`The shared Codex proxy failed: ${error.message}`)));
    child.once("exit", (code, signal) => {
      const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      this.fail(new Error(`The shared Codex proxy ended during its WebSocket handshake (${status}).`));
    });
  }

  open(timeoutMs: number) {
    if (this.opened) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      this.resolveOpening = resolve;
      this.rejectOpening = reject;
      this.openingTimeout = setTimeout(() => {
        this.fail(new Error("The shared Codex proxy WebSocket handshake timed out."));
      }, timeoutMs);
      this.child.stdin.write([
        "GET / HTTP/1.1",
        "Host: localhost",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${this.key}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"));
    });
    return this.opening;
  }

  send(message: string) {
    if (!this.opened) throw new Error("The shared Codex proxy handshake is not complete.");
    this.writeFrame(0x1, Buffer.from(message));
  }

  private receiveBytes(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      if (!this.opened && !this.receiveHandshake()) return;
      this.receiveFrames();
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      if (this.opened) this.child.kill();
    }
  }

  private receiveHandshake() {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return false;
    const header = this.buffer.subarray(0, headerEnd).toString("utf8");
    this.buffer = this.buffer.subarray(headerEnd + 4);
    const lines = header.split("\r\n");
    if (!/^HTTP\/1\.1 101\b/.test(lines[0] ?? "")) {
      throw new Error(`The shared Codex proxy rejected the WebSocket upgrade: ${lines[0] ?? "invalid response"}`);
    }
    const headers = new Map(lines.slice(1).map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    }));
    const expectedAccept = createHash("sha1").update(`${this.key}${WEBSOCKET_GUID}`).digest("base64");
    if (headers.get("sec-websocket-accept") !== expectedAccept) {
      throw new Error("The shared Codex proxy returned an invalid WebSocket accept key.");
    }
    this.opened = true;
    if (this.openingTimeout) clearTimeout(this.openingTimeout);
    this.openingTimeout = undefined;
    this.resolveOpening?.();
    this.resolveOpening = undefined;
    this.rejectOpening = undefined;
    return true;
  }

  private receiveFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0]!;
      const second = this.buffer[1]!;
      const final = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let offset = 2;
      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        const length = this.buffer.readBigUInt64BE(2);
        if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The shared Codex proxy returned an oversized frame.");
        payloadLength = Number(length);
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + payloadLength) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLength));
      this.buffer = this.buffer.subarray(offset + payloadLength);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
      }
      this.receiveFrame(opcode, final, payload);
    }
  }

  private receiveFrame(opcode: number, final: boolean, payload: Buffer) {
    if (opcode === 0x8) {
      this.child.kill();
      return;
    }
    if (opcode === 0x9) {
      this.writeFrame(0xA, payload);
      return;
    }
    if (opcode === 0xA) return;
    if (opcode === 0x1 || opcode === 0x2) {
      this.fragmentOpcode = opcode;
      this.fragments = [payload];
    } else if (opcode === 0x0 && this.fragmentOpcode !== undefined) {
      this.fragments.push(payload);
    } else {
      throw new Error(`The shared Codex proxy returned unsupported WebSocket opcode ${opcode}.`);
    }
    if (!final) return;
    const message = Buffer.concat(this.fragments).toString("utf8");
    this.fragments = [];
    this.fragmentOpcode = undefined;
    for (const line of message.split(/\r?\n/)) {
      if (line.trim()) this.onMessage(line);
    }
  }

  private writeFrame(opcode: number, payload: Buffer) {
    const mask = randomBytes(4);
    let header: Buffer;
    if (payload.length <= 125) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index]! ^ mask[index % 4]!;
    this.child.stdin.write(Buffer.concat([header, mask, masked]));
  }

  private fail(error: Error) {
    if (this.openingTimeout) clearTimeout(this.openingTimeout);
    this.openingTimeout = undefined;
    this.rejectOpening?.(error);
    this.resolveOpening = undefined;
    this.rejectOpening = undefined;
  }
}
