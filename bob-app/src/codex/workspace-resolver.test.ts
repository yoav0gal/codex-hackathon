import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceResolver } from "./workspace-resolver.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Bob workspace resolver", () => {
  it("matches spoken project names across punctuation and case", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bob-workspaces-"));
    temporaryDirectories.push(root);
    const project = path.join(root, "job-seeeker-agent");
    await mkdir(project);

    await expect(new WorkspaceResolver([root]).resolve("Job Seeeker Agent")).resolves.toBe(await realpath(project));
  });

  it("searches configured roots with normalized partial names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bob-workspaces-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "codex-hackathon"));
    await mkdir(path.join(root, "KitKit"));

    await expect(new WorkspaceResolver([root]).search("hackathon")).resolves.toEqual([
      path.join(root, "codex-hackathon"),
    ]);
  });

  it("explains how to configure an unknown project root", async () => {
    await expect(new WorkspaceResolver([]).resolve("missing app")).rejects.toThrow("BOB_PROJECT_ROOTS");
  });
});
