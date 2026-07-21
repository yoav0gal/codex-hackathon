import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const modelName = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01";
const encoder = "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
const decoder = "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
const joiner = "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
const heyBobKeyword = "▁HE Y ▁BO B :3 #0.1";

export class SherpaWakeEngine {
  private keywordSpotter: KeywordSpotter | undefined;
  private stream: KeywordStream | undefined;

  constructor(private readonly applicationPath: string) {}

  start() {
    this.stop();
    this.keywordSpotter ??= createKeywordSpotter(this.applicationPath);
    this.stream = this.keywordSpotter.createStream();
  }

  process(samples: Float32Array, sampleRate: number) {
    if (!this.keywordSpotter || !this.stream) return false;
    this.stream.acceptWaveform(sampleRate, samples);
    while (this.keywordSpotter.isReady(this.stream)) {
      this.keywordSpotter.decode(this.stream);
      if (!this.keywordSpotter.getResult(this.stream).keyword) continue;
      this.keywordSpotter.reset(this.stream);
      return true;
    }
    return false;
  }

  stop() {
    this.stream?.free();
    this.stream = undefined;
  }

  dispose() {
    this.stop();
    this.keywordSpotter?.free();
    this.keywordSpotter = undefined;
  }
}

function createKeywordSpotter(applicationPath: string): KeywordSpotter {
  let sherpa: SherpaModule;
  try {
    sherpa = require("sherpa-onnx") as SherpaModule;
  } catch {
    throw new Error("Local wake detection is not installed. Run npm install, then restart Bob.");
  }

  const modelDirectory = path.join(applicationPath, ".local", "wake", modelName);
  try {
    return sherpa.createKws({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(modelDirectory, encoder),
          decoder: path.join(modelDirectory, decoder),
          joiner: path.join(modelDirectory, joiner),
        },
        tokens: path.join(modelDirectory, "tokens.txt"),
        numThreads: 1,
        provider: "cpu",
      },
      maxActivePaths: 4,
      keywordsScore: 3,
      keywordsThreshold: 0.1,
      keywords: heyBobKeyword,
    });
  } catch {
    throw new Error("Local wake model is missing or invalid. Run npm run setup:wake, then restart Bob.");
  }
}

interface KeywordSpotter {
  createStream(): KeywordStream;
  isReady(stream: KeywordStream): boolean;
  decode(stream: KeywordStream): void;
  getResult(stream: KeywordStream): { keyword?: string };
  reset(stream: KeywordStream): void;
  free(): void;
}

interface KeywordStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}

interface SherpaModule {
  createKws(config: unknown): KeywordSpotter;
}
