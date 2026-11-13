import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateBash, evaluateFileTool } from "../agent/extensions/harness/guards/index.ts";
import { HOME, input } from "./helpers.ts";

type Over = Parameters<typeof input>[0];
const bash = (cmd: string, over: Over = {}) => evaluateBash(cmd, input(over)).kind;
const file = (tool: string, p: string, over: Over = {}) =>
  evaluateFileTool(tool, { path: p }, input(over)).kind;

test("通常の開発コマンドは許可", () => {
  for (const cmd of [
    "npm test",
    "node --test",
    "git status && git diff",
    "git add -A && git commit -m 'feat: x'",
    "ls -la src | head",
    "grep -rn TODO src",
    "mkdir -p out && echo ok > out/a.txt",
    "gh pr view 1",
    "rm -rf dist",
  ]) {
    assert.equal(bash(cmd), "allow", cmd);
  }
});

test("複数のガードにまたがる危険なコマンドを拒否する", () => {
  for (const cmd of [
    "git push --force origin main",
    "sudo rm -rf /",
    "cat .env",
    "env",
    "rm -rf /",
    "pkill node",
    "echo $(cat .env)",
    "bash -c 'git push origin main'",
    "git commit --no-verify -m x",
  ]) {
    assert.equal(bash(cmd), "block", cmd);
  }
});

test("許可制の操作は ask になる", () => {
  for (const cmd of [
    "npm install -g x",
    "git reset --hard",
    "git rebase main",
    "git commit --amend",
  ]) {
    assert.equal(bash(cmd), "ask", cmd);
  }
});

test("解析できないコマンドと opaque な実行は拒否する", () => {
  assert.equal(bash("echo 'unclosed"), "block");
  assert.equal(bash('sh -c "$CMD"'), "block");
  assert.equal(bash("eval $X"), "block");
});

test("サブエージェントは、書き込みの Git 操作ができない", () => {
  assert.equal(bash("git commit -m x", { subagent: true }), "block");
  assert.equal(bash("git push origin feat/x", { subagent: true }), "block");
  assert.equal(bash("git diff", { subagent: true }), "allow");
});

test("ファイルツール: 秘密のファイルは読めない・書けない", () => {
  assert.equal(file("read", ".env"), "block");
  assert.equal(file("write", ".env.local"), "block");
  assert.equal(file("edit", `${HOME}/.ssh/config`), "block");
  assert.equal(file("read", ".env.example"), "allow");
  assert.equal(file("grep", "src"), "allow");
});

test("ファイルツール: 既定ブランチ上では書き込めない。読み取りはできる", () => {
  assert.equal(file("write", "src/a.ts", { branch: "main" }), "block");
  assert.equal(file("edit", "src/a.ts", { branch: "master" }), "block");
  assert.equal(file("read", "src/a.ts", { branch: "main" }), "allow");
  assert.equal(file("write", "src/a.ts", { branch: "feat/x" }), "allow");
});

test("ファイルツール: リポジトリの外(/tmp など)は、既定ブランチ上でも書ける", () => {
  assert.equal(file("write", "/tmp/note.txt", { branch: "main" }), "allow");
});

test("ファイルツール: .git の中は書けない", () => {
  assert.equal(file("write", ".git/hooks/pre-commit"), "block");
  assert.equal(file("edit", ".git/config"), "block");
});

test("ファイルツール: グローバル環境と ~/.pi/agent は許可制", () => {
  assert.equal(file("write", `${HOME}/Dev/kaishi/ubuntu-dotfiles/home.nix`), "ask");
  assert.equal(file("write", `${HOME}/.pi/agent/settings.json`), "ask");
});

test("対象外のツールは許可", () => {
  assert.equal(evaluateFileTool("subagent", { task: "x" }, input({})).kind, "allow");
});
