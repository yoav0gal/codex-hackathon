import type { DesktopBridge } from "../../contracts/ipc";

export interface WakeDetector {
  start(onDetected: () => void, onError: (message: string) => void): Promise<void>;
  stop(): Promise<void>;
}

interface WakeBrowserEnvironment {
  getMicrophone(): Promise<MediaStream>;
  createAudioContext(): AudioContext;
}

export const browserWakeEnvironment: WakeBrowserEnvironment = {
  getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createAudioContext: () => new AudioContext({ sampleRate: 16_000 }),
};

export class LocalWakeDetector implements WakeDetector {
  private generation = 0;
  private media: MediaStream | undefined;
  private context: AudioContext | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private processor: ScriptProcessorNode | undefined;
  private processing = false;
  private detected = false;

  constructor(
    private readonly bridge: DesktopBridge,
    private readonly environment: WakeBrowserEnvironment = browserWakeEnvironment,
  ) {}

  async start(onDetected: () => void, onError: (message: string) => void) {
    const expectedGeneration = ++this.generation;
    this.detected = false;
    try {
      await this.bridge.startWakeEngine();
      if (expectedGeneration !== this.generation) return;
      const media = await this.environment.getMicrophone();
      if (expectedGeneration !== this.generation) {
        stopMedia(media);
        return;
      }

      const context = this.environment.createAudioContext();
      const source = context.createMediaStreamSource(media);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (this.processing || this.detected || expectedGeneration !== this.generation) return;
        this.processing = true;
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        void this.bridge.processWakeAudio(samples, context.sampleRate)
          .then((heardWakePhrase) => {
            if (!heardWakePhrase || this.detected || expectedGeneration !== this.generation) return;
            this.detected = true;
            onDetected();
          })
          .catch(() => onError("Local wake detection failed. Click Bob to retry."))
          .finally(() => {
            this.processing = false;
          });
      };
      source.connect(processor);
      processor.connect(context.destination);
      this.media = media;
      this.context = context;
      this.source = source;
      this.processor = processor;
    } catch (error) {
      await this.releaseResources();
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      throw new Error(
        denied
          ? "Microphone access was denied. Allow it in System Settings to use ‘Hey, Bob’."
          : error instanceof Error
            ? error.message
            : "Local wake detection could not start. Click Bob to continue.",
      );
    }
  }

  async stop() {
    this.generation += 1;
    await this.releaseResources();
  }

  private async releaseResources() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = undefined;
    this.source = undefined;
    stopMedia(this.media);
    this.media = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
    await this.bridge.stopWakeEngine();
  }
}

function stopMedia(media: MediaStream | undefined) {
  for (const track of media?.getTracks() ?? []) track.stop();
}
