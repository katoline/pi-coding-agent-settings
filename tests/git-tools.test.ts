import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { registerGitTools } from "../agent/extensions/harness/flow/git-tools.ts";
import { createRuntime } from "../agent/extensions/harness/lib/runtime.ts";

const run = promisify(execFile);
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harness-git-")));
after(() => rmSync(tmp, { recursive: true, force: true }));

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });

// 偽の origin(bare)と、作業用のリポジトリ
const origin = path.join(tmp, "origin.git");
const repo = path.join(tmp, "app");
sh(tmp, "init", "-q", "--bare", "-b", "main", origin);
sh(tmp, "init", "-q", "-b", "main", repo);
writeFileSync(path.join(repo, "a.txt"), "A");
sh(repo, "add", "-A");
sh(repo, "commit", "-q", "-m", "init");
sh(repo, "remote", "add", "origin", origin);
sh(repo, "push", "-q", "-u", "origin", "main");

type Tool = {
  execute: (
    id: string,
    params: unknown,
    s: undefined,
    u: undefined,
    ctx: unknown,
  ) => Promise<{ content: { text: string }[] }>;
};
const tools: Record<string, Tool> = {};
const rt = createRuntime({});
const pi = {
  registerTool: (t: { name: string } & Tool) => {
    tools[t.name] = t;
  },
  on: () => () => {},
  appendEntry: () => {},
  exec: async (command: string, args: string[], options: { cwd?: string } = {}) => {
    try {
      const r = await run(command, args, {
        cwd: options.cwd,
        env: gitEnv,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { code: 0, stdout: r.stdout, stderr: r.stderr, killed: false, truncated: false };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      return {
        code: typeof err.code === "number" ? err.code : 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String(e),
        killed: false,
        truncated: false,
      };
    }
  },
};
registerGitTools(pi as never, rt);
const ctx = {
  cwd: repo,
  hasUI: false,
  ui: { notify() {}, confirm: async () => false },
  sessionManager: { getBranch: () => [] },
};
const call = async (name: string, params: unknown) =>
  (await (tools[name] as Tool).execute("id", params, undefined, undefined, ctx)).content[0]?.text ??
  "";

test("worktree を、リポジトリの隣に作り、自分が作ったものとして記録する", async () => {
  const msg = await call("harness_worktree", { action: "create", branch: "feat/x" });
  const wt = `${repo}.worktrees/feat-x`;
  assert.match(msg, /worktree を作りました/);
  assert.ok(existsSync(path.join(wt, "a.txt")));
  assert.ok(rt.ownedWorktrees.has(wt));
  assert.equal(sh(wt, "branch", "--show-current").trim(), "feat/x");
  assert.match(
    await call("harness_worktree", { action: "create", branch: "feat/x" }),
    /すでにあります/,
  );
});

test("worktree: 既定ブランチ・不正なブランチ名は拒否する", async () => {
  assert.match(
    await call("harness_worktree", { action: "create", branch: "main" }),
    /既定ブランチ/,
  );
  assert.match(await call("harness_worktree", { action: "create", branch: "a b;c" }), /不正/);
});

test("worktree の削除: 他のもの・相対パスは拒否。未保存・未 push の成果物があれば残す", async () => {
  const wt = `${repo}.worktrees/feat-x`;
  assert.match(await call("harness_worktree", { action: "remove", path: "../x" }), /絶対パス/);
  assert.match(
    await call("harness_worktree", { action: "remove", path: `${tmp}/other` }),
    /作った worktree ではありません/,
  );

  writeFileSync(path.join(wt, "new.txt"), "N");
  assert.match(
    await call("harness_worktree", { action: "remove", path: wt }),
    /未保存の変更があるため、残します/,
  );

  sh(wt, "add", "-A");
  sh(wt, "commit", "-q", "-m", "work");
  assert.match(
    await call("harness_worktree", { action: "remove", path: wt }),
    /push されていないコミット/,
  );
  assert.ok(existsSync(wt));

  sh(wt, "push", "-q", "-u", "origin", "feat/x");
  assert.match(
    await call("harness_worktree", { action: "remove", path: wt }),
    /worktree を削除しました/,
  );
  assert.ok(!existsSync(wt));
  assert.ok(!rt.ownedWorktrees.has(wt));
});

test("PR の作成は、既定ブランチ上では拒否する", async () => {
  assert.match(
    await call("harness_pr_create", { title: "x" }),
    /既定ブランチ\(main\)上では、PR を作れません/,
  );
});

test("PR の作成は、コミットされていない変更があれば拒否する", async () => {
  sh(repo, "switch", "-q", "-c", "feat/y");
  writeFileSync(path.join(repo, "dirty.txt"), "D");
  assert.match(await call("harness_pr_create", { title: "x" }), /コミットされていない変更/);
});

test("ブランチ保護を確認できない環境では、PR の作成・push に進まない", async () => {
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "wip");
  const msg = await call("harness_pr_create", { title: "x" });
  assert.match(msg, /ルールセット|GitHub|ブランチ保護/);
  // push されていない(origin に feat/y がない)
  assert.equal(sh(repo, "ls-remote", "--heads", "origin", "feat/y").trim(), "");
});

test("マージは、PR が見つからなければ何もしない", async () => {
  assert.match(await call("harness_pr_merge", {}), /PR が見つかりません/);
});
