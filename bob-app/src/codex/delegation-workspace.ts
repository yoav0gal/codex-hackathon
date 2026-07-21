import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

/** The dedicated Codex project used for Bob's general delegations. */
export class DelegationWorkspace {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async ensure() {
    await mkdir(this.root, { recursive: true });
    return realpath(this.root);
  }
}
