import assert from "node:assert/strict";
import { test } from "node:test";
import { probeGitState } from "../agent/extensions/harness/lib/git-state.ts";
import { config } from "./helpers.ts";

function fakeGit(map: Record<string, string>) {
  return async (args: string[]) => {
    const key = args.join(" ");
    return key in map ? { code: 0, stdout: map[key] as string } : { code: 128, stdout: "" };
  };
}

test("リポジトリの外では inRepo が false", async () => {
  const state = await probeGitState(fakeGit({}), config, {
    needMerged: false,
    ownedWorktrees: new Set(),
  });
  assert.equal(state.inRepo, false);
  assert.equal(state.currentBranch, null);
});

test("現在のブランチと、origin/HEAD の指す先を既定ブランチに加える", async () => {
  const state = await probeGitState(
    fakeGit({
      "rev-parse --show-toplevel": "/r\n",
      "branch --show-current": "feat/a\n",
      "symbolic-ref --short refs/remotes/origin/HEAD": "origin/agent/bootstrap\n",
    }),
    config,
    { needMerged: false, ownedWorktrees: new Set() },
  );
  assert.equal(state.repoRoot, "/r");
  assert.equal(state.currentBranch, "feat/a");
  assert.ok(state.defaultBranches.has("main"));
  assert.ok(state.defaultBranches.has("agent/bootstrap"));
});

test("マージ済みのリモートブランチは、必要なときだけ調べる(既定ブランチと HEAD の行は除く)", async () => {
  const map = {
    "rev-parse --show-toplevel": "/r",
    "branch --show-current": "main",
    "branch -r --merged origin/main":
      "  origin/HEAD -> origin/main\n  origin/main\n  origin/feat/old\n",
  };
  const without = await probeGitState(fakeGit(map), config, {
    needMerged: false,
    ownedWorktrees: new Set(),
  });
  assert.equal(without.mergedRemoteBranches.size, 0);
  const withMerged = await probeGitState(fakeGit(map), config, {
    needMerged: true,
    ownedWorktrees: new Set(),
  });
  assert.deepEqual([...withMerged.mergedRemoteBranches], ["feat/old"]);
});

test("detached HEAD は currentBranch が null", async () => {
  const state = await probeGitState(
    fakeGit({ "rev-parse --show-toplevel": "/r", "branch --show-current": "\n" }),
    config,
    { needMerged: false, ownedWorktrees: new Set() },
  );
  assert.equal(state.currentBranch, null);
});
