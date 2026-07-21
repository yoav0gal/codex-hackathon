import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const modelName = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01";
const modelUrl = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${modelName}.tar.bz2`;
const modelSha256 = "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a";
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wakeDirectory = path.join(repositoryRoot, ".local", "wake");
const modelDirectory = path.join(wakeDirectory, modelName);
const requiredAssets = [
  "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
  "tokens.txt",
].map((file) => path.join(modelDirectory, file));
const run = promisify(execFile);

try {
  await Promise.all(requiredAssets.map((asset) => access(asset)));
  console.log(`Wake model is ready at ${modelDirectory}`);
  process.exit(0);
} catch {
  // Continue with the verified installation.
}

await mkdir(wakeDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "bob-wake-model-"));
try {
  console.log(`Downloading ${modelName}...`);
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const checksum = createHash("sha256").update(archive).digest("hex");
  if (checksum !== modelSha256) throw new Error(`checksum mismatch: received ${checksum}`);

  const archivePath = path.join(temporaryDirectory, `${modelName}.tar.bz2`);
  await writeFile(archivePath, archive);
  await run("tar", ["-xjf", archivePath, "-C", temporaryDirectory]);
  await rm(modelDirectory, { recursive: true, force: true });
  await rename(path.join(temporaryDirectory, modelName), modelDirectory);
  console.log(`Wake model installed at ${modelDirectory}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
