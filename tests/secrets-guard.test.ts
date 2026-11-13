import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkEnvDump,
  checkSecretsBash,
  checkSecretToolPath,
  findSecretFiles,
  isSecretPath,
  redact,
} from "../agent/extensions/harness/guards/secrets.ts";
import { invocations, parseShell } from "../agent/extensions/harness/lib/shell.ts";
import { combine, type Verdict } from "../agent/extensions/harness/lib/verdict.ts";
import { HOME, input } from "./helpers.ts";

const bash = (cmd: string): Verdict => {
  const parsed = parseShell(cmd);
  return combine([
    checkEnvDump(parsed),
    ...invocations(parsed).map((i) => checkSecretsBash(i, input({}))),
  ]);
};

test("秘密のファイルを判定する(テンプレートは除く)", () => {
  for (const p of [
    ".env",
    ".env.local",
    "app/.env.production",
    "id_rsa",
    "key.pem",
    "a/b/server.key",
    ".npmrc",
    "credentials.json",
    `${HOME}/.ssh/config`,
    `${HOME}/.aws/credentials`,
    `${HOME}/.pi/agent/auth.json`,
    "/proc/1/environ",
    "service-account-prod.json",
  ]) {
    assert.equal(isSecretPath(p), true, p);
  }
  for (const p of [
    ".env.example",
    ".env.sample",
    "id_rsa.pub",
    "src/env.ts",
    "README.md",
    "keyboard.ts",
    ".envrc",
  ]) {
    assert.equal(isSecretPath(p), false, p);
  }
});

test("秘密のファイルの抽出", () => {
  assert.deepEqual(findSecretFiles(["a.ts", ".env", "k.pem", ".env.example"]), [".env", "k.pem"]);
});

test("read / write / edit のパス引数を検査する", () => {
  assert.equal(checkSecretToolPath(".env", input({})).kind, "block");
  assert.equal(checkSecretToolPath("~/.ssh/id_ed25519", input({})).kind, "block");
  assert.equal(checkSecretToolPath(".env.example", input({})).kind, "allow");
  assert.equal(checkSecretToolPath("src/a.ts", input({})).kind, "allow");
});

test("bash から秘密のファイルを読むコマンドを拒否する", () => {
  for (const cmd of [
    "cat .env",
    "head -n 3 .env.local",
    "grep TOKEN .env",
    "cp .env /tmp/x",
    "source .env",
    "base64 ~/.ssh/id_rsa",
    "cat .env*",
    "rg -n KEY --glob '!x' app/.env",
    "git add .env",
    "echo hi > .env",
    "cat /proc/self/environ",
  ]) {
    assert.equal(bash(cmd).kind, "block", cmd);
  }
});

test("環境変数の一覧や、秘密を持つ変数の出力を拒否する", () => {
  for (const cmd of [
    "env",
    "printenv",
    "printenv ANTHROPIC_API_KEY",
    "export -p",
    "declare -p",
    "set",
    'echo "$GITHUB_TOKEN"',
    "printf '%s' $API_KEY",
  ]) {
    assert.equal(bash(cmd).kind, "block", cmd);
  }
});

test("通常のコマンドは許可", () => {
  for (const cmd of [
    "cat README.md",
    "grep -rn foo src",
    "env FOO=1 node a.js",
    "git add .env.example",
    "echo hello",
    "printenv HOME",
    "ls -la",
  ]) {
    assert.equal(bash(cmd).kind, "allow", cmd);
  }
});

test("出力から秘密を秘匿する", () => {
  const samples: [string, string][] = [
    ["key sk-ant-api03-abcdefghijklmnopqrstuvwx end", "sk-ant-"],
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end", "ghp_"],
    ["AKIAABCDEFGHIJKLMNOP", "AKIA"],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "abcdefghijkl"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "eyJhbGci"],
    ["postgres://user:hunter2pass@db:5432/x", "hunter2pass"],
    ["API_KEY=abcdef123456", "abcdef123456"],
    ['password: "supersecretvalue"', "supersecretvalue"],
    ["-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----", "MIIabc"],
  ];
  for (const [text, secret] of samples) {
    const out = redact(text);
    assert.equal(out.includes(secret), false, `${text} -> ${out}`);
    assert.match(out, /秘匿/);
  }
  assert.equal(redact("普通のログ: 12 files changed"), "普通のログ: 12 files changed");
});
