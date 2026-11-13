import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../agent/extensions/harness/lib/config.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "harness-config-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("既定の設定は、~ を展開した作業ルートを持つ", () => {
  const c = loadConfig("/home/u", path.join(tmp, "none.json"), {});
  assert.ok(c.workRoots.includes("/home/u/Dev/kaishi"));
  assert.ok(c.protectedGlobalPaths.includes("/home/u/Dev/kaishi/ubuntu-dotfiles"));
  assert.deepEqual(c.defaultBranches, ["main", "master"]);
});

test("上書きの設定は、既定に重なる", () => {
  const f = path.join(tmp, "o.json");
  writeFileSync(f, JSON.stringify({ workRoots: ["~/x"], selectModelOnStartup: false }));
  const c = loadConfig("/home/u", f, {});
  assert.deepEqual(c.workRoots, ["/home/u/x"]);
  assert.equal(c.selectModelOnStartup, false);
  assert.deepEqual(c.defaultBranches, ["main", "master"]);
});

test("壊れた上書きは無視して、既定を使う", () => {
  const f = path.join(tmp, "broken.json");
  writeFileSync(f, "{ not json");
  const c = loadConfig("/home/u", f, {});
  assert.ok(c.workRoots.includes("/home/u/Dev/seino914"));
});

test("PI_CODING_AGENT_DIR の harness.json を読む", () => {
  const dir = path.join(tmp, "agentdir");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "harness.json"), JSON.stringify({ dropContextFiles: true }));
  const c = loadConfig("/home/u", undefined, { PI_CODING_AGENT_DIR: dir });
  assert.equal(c.dropContextFiles, true);
});
