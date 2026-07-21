import { readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Resolves and searches the configured local Codex project roots. */
export class WorkspaceResolver {
  constructor(private readonly roots: string[]) {}

  async resolve(reference: string): Promise<string> {
    const requested = reference.trim();
    if (!requested) throw new Error("Tell Bob which code project to use.");

    const directPath = requested === "~"
      ? os.homedir()
      : requested.startsWith(`~${path.sep}`)
        ? path.join(os.homedir(), requested.slice(2))
        : requested;
    if (path.isAbsolute(directPath)) return verifyDirectory(directPath);

    const wanted = normalizeProjectName(requested);
    const matches: string[] = [];
    for (const root of this.roots) {
      for (const entry of await directoryEntries(root)) {
        if (!entry.isDirectory() || normalizeProjectName(entry.name) !== wanted) continue;
        matches.push(path.join(root, entry.name));
      }
    }

    if (matches.length === 0) {
      throw new Error(`Bob could not find the code project “${requested}”. Say its full path or add its parent to BOB_PROJECT_ROOTS.`);
    }
    if (matches.length > 1) {
      throw new Error(`Bob found more than one project named “${requested}”. Say the full path.`);
    }
    return verifyDirectory(matches[0]!);
  }

  async search(query: string, limit = 10): Promise<string[]> {
    const wanted = normalizeProjectName(query);
    const matches: Array<{ path: string; score: number }> = [];
    for (const root of this.roots) {
      for (const entry of await directoryEntries(root)) {
        if (!entry.isDirectory()) continue;
        const score = projectScore(normalizeProjectName(entry.name), wanted);
        if (score > 0) matches.push({ path: path.join(root, entry.name), score });
      }
    }
    matches.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    return matches.slice(0, limit).map((match) => match.path);
  }
}

async function directoryEntries(root: string) {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeProjectName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function projectScore(candidate: string, wanted: string) {
  if (!wanted) return 1;
  if (candidate === wanted) return 100;
  if (candidate.startsWith(wanted)) return 80;
  if (candidate.includes(wanted)) return 60;
  return 0;
}

async function verifyDirectory(candidate: string) {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(candidate);
  } catch {
    throw new Error(`The code project does not exist: ${candidate}`);
  }
  if (!metadata.isDirectory()) throw new Error(`The code project is not a directory: ${candidate}`);
  return realpath(candidate);
}
