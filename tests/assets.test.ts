import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadAgents } from "../agent/extensions/harness/subagent/agents.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "harness-assets-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("役割の定義: scout・planner・reviewer は読み取り専用、worker は書き込み可", () => {
  const agents = loadAgents(path.join(root, "agent/agents"));
  const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ["planner", "reviewer", "scout", "worker"]);
  for (const name of ["scout", "planner", "reviewer"]) {
    assert.deepEqual(byName[name]?.tools, ["read", "grep", "find", "ls"], name);
  }
  assert.equal(byName.worker?.tools, undefined);
  // 既定のモデルは固定しない(/subagent-model で選んだモデルを使う)
  for (const a of agents) assert.equal(a.model, undefined, a.name);
});

test("レビュー担当の指示は、末尾のマーカーを要求し、指示への追従を禁じる", () => {
  const reviewer = loadAgents(path.join(root, "agent/agents")).find((a) => a.name === "reviewer");
  assert.ok(reviewer, "reviewer の定義があるはず");
  assert.ok(
    reviewer.instructions.includes("<approved/>") &&
      reviewer.instructions.includes("<disapproved/>"),
  );
  assert.ok(reviewer.instructions.includes("従わない"));
});

test("設定: enabledModels に、3 つのプロバイダのモデルを含む", () => {
  const settings = JSON.parse(readFileSync(path.join(root, "agent/settings.json"), "utf8")) as {
    enabledModels: string[];
  };
  assert.ok(settings.enabledModels.includes("opencode-go/*"));
  assert.ok(settings.enabledModels.includes("anthropic/claude-opus-5-5"));
  assert.ok(settings.enabledModels.includes("openai-codex/*"));
});

const setup = path.join(root, "agent/skills/nix-setup/scripts/setup.mjs");
const run = (...args: string[]) =>
  spawnSync(process.execPath, [setup, ...args], { encoding: "utf8" });

test("nix-setup: Nix・Biome・Dependabot・CI を作る", () => {
  const dir = path.join(tmp, "proj");
  mkdirSync(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  for (const f of [
    "flake.nix",
    ".envrc",
    "biome.json",
    ".github/dependabot.yml",
    ".github/workflows/quality.yml",
    "package.json",
  ]) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  assert.match(
    readFileSync(path.join(dir, ".github/workflows/quality.yml"), "utf8"),
    /name: quality/,
  );
  assert.match(readFileSync(path.join(dir, "flake.nix"), "utf8"), /nodejs_22/);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    scripts: { check: string };
  };
  assert.ok(pkg.scripts.check.includes("biome"));
  const ignore = readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.ok(ignore.includes("node_modules/") && ignore.includes("!.env.example"));
});

test("nix-setup: 既存のファイルは上書きしない。2 回目は何も作らない", () => {
  const dir = path.join(tmp, "proj2");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "biome.json"), "既存");
  writeFileSync(path.join(dir, ".gitignore"), "dist/\n");
  const first = run(dir);
  assert.match(first.stdout, /スキップ\(すでにある\): biome.json/);
  assert.equal(readFileSync(path.join(dir, "biome.json"), "utf8"), "既存");
  assert.ok(readFileSync(path.join(dir, ".gitignore"), "utf8").startsWith("dist/\n"));
  const second = run(dir);
  assert.ok(!second.stdout.includes("作成:"), second.stdout);
});

test("nix-setup: --dry-run は何も書かない。存在しないディレクトリは失敗する", () => {
  const dir = path.join(tmp, "proj3");
  mkdirSync(dir);
  const r = run(dir, "--dry-run");
  assert.match(r.stdout, /dry-run/);
  assert.ok(!existsSync(path.join(dir, "flake.nix")));
  assert.notEqual(run(path.join(tmp, "nope")).status, 0);
});

const install = path.join(root, "scripts/install.sh");
const runInstall = (agentDir: string, ...args: string[]) =>
  spawnSync("bash", [install, ...args], {
    encoding: "utf8",
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  });

test("install.sh: 拡張・役割・スキル・設定を、リンクで配置する。auth.json には触れない", () => {
  const dir = path.join(tmp, "agent1");
  const r = runInstall(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readlinkSync(path.join(dir, "extensions/harness")),
    path.join(root, "agent/extensions/harness"),
  );
  assert.ok(lstatSync(path.join(dir, "agents/reviewer.md")).isSymbolicLink());
  assert.ok(lstatSync(path.join(dir, "skills/nix-setup")).isSymbolicLink());
  assert.ok(lstatSync(path.join(dir, "settings.json")).isSymbolicLink());
  assert.ok(!existsSync(path.join(dir, "auth.json")));
  // 2 回目は、何も変えない
  const again = runInstall(dir);
  assert.equal(again.status, 0);
  assert.ok(!again.stdout.includes("リンク:"), again.stdout);
});

test("install.sh: 既存のファイルは上書きせず、競合として失敗する", () => {
  const dir = path.join(tmp, "agent2");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "settings.json"), '{"mine":true}');
  const r = runInstall(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /競合/);
  assert.equal(readFileSync(path.join(dir, "settings.json"), "utf8"), '{"mine":true}');
  // それ以外は配置されている
  assert.ok(lstatSync(path.join(dir, "extensions/harness")).isSymbolicLink());
});

test("install.sh: --dry-run は何も作らない", () => {
  const dir = path.join(tmp, "agent3");
  const r = runInstall(dir, "--dry-run");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /リンク:/);
  assert.ok(!existsSync(dir));
});

test("リンクされた拡張が、実際の Pi で読み込める(設定ディレクトリごと)", () => {
  const dir = path.join(tmp, "agent4");
  assert.equal(runInstall(dir).status, 0);
  writeFileSync(path.join(dir, "harness.json"), JSON.stringify({ selectModelOnStartup: false }));
  const cli = path.join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const out = execFileSync(process.execPath, [cli, "--offline", "--list-models"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: dir,
      PI_OFFLINE: "1",
      ANTHROPIC_API_KEY: "dummy",
      OPENCODE_API_KEY: "dummy",
    },
  });
  assert.match(out, /claude-opus-5-5/);
  assert.match(out, /opencode-go\s+deepseek-v4\.1-flash/);
});
