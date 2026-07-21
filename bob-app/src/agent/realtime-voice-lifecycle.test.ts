import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentSnapshot } from "./types";
import { OpenAIRealtimeAgent } from "./realtime-agent";

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener === "function") this.listeners.get(type)?.delete(listener);
  }

  protected emit(type: string, event: any = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeDataChannel extends FakeEventTarget {
  readyState: RTCDataChannelState = "open";
  readonly sent: unknown[] = [];

  send(payload: string) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = "closed";
  }

  serverEvent(event: unknown) {
    this.emit("message", { data: JSON.stringify(event) });
  }
}

class FakePeerConnection extends FakeEventTarget {
  connectionState: RTCPeerConnectionState = "connected";
  readonly channel = new FakeDataChannel();
  readonly tracks: MediaStreamTrack[] = [];

  createDataChannel() {
    return this.channel as unknown as RTCDataChannel;
  }

  async createOffer() {
    return { type: "offer" as RTCSdpType, sdp: "offer" };
  }

  async setLocalDescription() {}
  async setRemoteDescription() {}

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
    return {} as RTCRtpSender;
  }

  addTransceiver() {
    return {} as RTCRtpTransceiver;
  }

  close() {
    this.connectionState = "closed";
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Realtime voice lifecycle", () => {
  it("opens the microphone and traverses listening, transcription, thinking, speaking, interruption, and disconnect", async () => {
    const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const media = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    const peer = new FakePeerConnection();
    const audio = {
      autoplay: false,
      hidden: false,
      srcObject: null,
      setAttribute: vi.fn(),
      play: vi.fn(async () => undefined),
      remove: vi.fn(),
    } as unknown as HTMLAudioElement;
    vi.stubGlobal("document", { body: { append: vi.fn() } });

    const agent = new OpenAIRealtimeAgent({
      getClientSecret: async () => ({ value: "ephemeral-secret" }),
      environment: {
        getMicrophone: async () => media,
        createPeerConnection: () => peer as unknown as RTCPeerConnection,
        createAudioElement: () => audio,
        fetch: async () => new Response("answer", { status: 200 }),
        setTimeout: () => 1,
        clearTimeout: () => undefined,
        now: () => 123,
        randomId: () => "id-1",
      },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => events.push(event));

    await agent.connect({ history: [], mode: "voice" });
    expect(peer.tracks).toEqual([track]);
    expect(agent.snapshot()).toEqual({ status: "listening", mode: "voice" });

    peer.channel.serverEvent({ type: "input_audio_buffer.speech_started", item_id: "user-1" });
    peer.channel.serverEvent({ type: "conversation.item.input_audio_transcription.delta", item_id: "user-1", delta: "hello" });
    peer.channel.serverEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "user-1", transcript: "hello Bob" });
    peer.channel.serverEvent({ type: "input_audio_buffer.speech_stopped" });
    expect(agent.snapshot()).toEqual({ status: "thinking", mode: "voice" });

    peer.channel.serverEvent({ type: "response.created" });
    peer.channel.serverEvent({ type: "output_audio_buffer.started" });
    expect(agent.snapshot()).toEqual({ status: "speaking", mode: "voice" });
    peer.channel.serverEvent({ type: "response.output_audio_transcript.done", item_id: "assistant-1", transcript: "I hear you." });
    peer.channel.serverEvent({ type: "output_audio_buffer.stopped" });
    expect(agent.snapshot()).toEqual({ status: "listening", mode: "voice" });

    peer.channel.serverEvent({ type: "output_audio_buffer.started" });
    peer.channel.serverEvent({ type: "input_audio_buffer.speech_started", item_id: "user-2" });
    expect(agent.snapshot()).toEqual({ status: "listening", mode: "voice" });

    const states = events
      .filter((event): event is { type: "state"; snapshot: AgentSnapshot } => event.type === "state")
      .map((event) => event.snapshot.status);
    expect(states).toEqual(expect.arrayContaining(["connecting", "listening", "thinking", "speaking"]));
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: expect.objectContaining({ role: "user", source: "voice", text: "hello Bob", final: true }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "message",
      message: expect.objectContaining({ role: "assistant", source: "voice", text: "I hear you.", final: true }),
    }));

    agent.disconnect();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(audio.remove).toHaveBeenCalledOnce();
    expect(agent.snapshot()).toEqual({ status: "disconnected" });
  });
});
