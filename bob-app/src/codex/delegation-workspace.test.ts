import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DelegationWorkspace } from "./delegation-workspace.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Bob delegation workspace", () => {
  it("creates and consistently reuses one dedicated Codex project", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "bob-delegations-"));
    temporaryDirectories.push(parent);
    const root = path.join(parent, "Bob Delegations");
    const workspace = new DelegationWorkspace(root);

    await expect(workspace.ensure()).resolves.toBe(await realpath(parent) + "/Bob Delegations");
    await expect(stat(root)).resolves.toMatchObject({});
    await expect(workspace.ensure()).resolves.toBe(await realpath(root));
  });
});
