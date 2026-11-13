import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadAgents, parseAgentFile } from "../agent/extensions/harness/subagent/agents.ts";
import {
  absorbEvent,
  buildChildArgs,
  buildChildEnv,
  type ChildResult,
  type ChildSpec,
  emptyUsage,
  isFailed,
  mapWithConcurrency,
  runChild,
} from "../agent/extensions/harness/subagent/child.ts";
import {
  doneLine,
  failLine,
  formatReport,
  startLine,
} from "../agent/extensions/harness/subagent/format.ts";

const agent = { name: "worker", description: "実装", instructions: "指示" };
const spec = (over: Partial<ChildSpec> = {}): ChildSpec => ({
  agent,
  task: "x を実装する",
  title: "x の実装",
  model: "opencode-go/deepseek-v4.1-flash",
  extensionPath: "/ext/index.ts",
  roleFile: "/tmp/role.md",
  cwd: "/work",
  ...over,
});
const tmp = mkdtempSync(path.join(os.tmpdir(), "harness-sub-test-"));

test("役割の定義(先頭部 + 本文)を読む", () => {
  const { meta, body } = parseAgentFile(
    "---\nname: scout\ndescription: 調査\ntools: read, grep\n---\n\n本文です\n",
  );
  assert.deepEqual(meta, { name: "scout", description: "調査", tools: "read, grep" });
  assert.equal(body, "本文です");
  assert.deepEqual(parseAgentFile("先頭部なし"), { meta: {}, body: "先頭部なし" });
});

test("役割のディレクトリを読む(name と description がないものは除く)", () => {
  const dir = path.join(tmp, "agents");
  writeFileSync(path.join(tmp, "x.md"), "");
  const fs = await_mkdir(dir);
  writeFileSync(
    path.join(fs, "a.md"),
    "---\nname: a\ndescription: A\ntools: read, ls\n---\nA の指示",
  );
  writeFileSync(path.join(fs, "b.md"), "---\nname: b\n---\nB");
  writeFileSync(path.join(fs, "c.txt"), "無視");
  const agents = loadAgents(fs);
  assert.deepEqual(
    agents.map((x) => x.name),
    ["a"],
  );
  assert.deepEqual(agents[0]?.tools, ["read", "ls"]);
  assert.equal(agents[0]?.instructions, "A の指示");
  assert.deepEqual(loadAgents(path.join(tmp, "nope")), []);
});

import { mkdirSync } from "node:fs";

function await_mkdir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("子の起動引数: ハーネスの拡張だけを読み込み、会話は保存しない", () => {
  const args = buildChildArgs(spec());
  assert.deepEqual(args.slice(0, 8), [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "-e",
    "/ext/index.ts",
    "--no-mcp",
  ]);
  assert.ok(args.includes("--no-skills") && args.includes("--no-prompt-templates"));
  assert.equal(args[args.indexOf("--model") + 1], "opencode-go/deepseek-v4.1-flash");
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "/tmp/role.md");
  assert.equal(args.at(-1), "Task: x を実装する");
  assert.ok(!args.includes("--tools"));
});

test("子の起動引数: 役割のツール制限と、役割のモデル指定", () => {
  const args = buildChildArgs(
    spec({ agent: { ...agent, tools: ["read", "grep"], model: "anthropic/claude-haiku-5-5" } }),
  );
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
  assert.equal(args[args.indexOf("--model") + 1], "anthropic/claude-haiku-5-5");
});

test("子の環境変数: PI_SUBAGENT=1 と役割を渡す", () => {
  const env = buildChildEnv(spec({ parentSessionId: "s1" }), { PATH: "/bin", PI_SUBAGENT: "0" });
  assert.equal(env.PI_SUBAGENT, "1");
  assert.equal(env.PI_SUBAGENT_ROLE, "worker");
  assert.equal(env.PI_HARNESS_PARENT_SESSION, "s1");
  assert.equal(env.PATH, "/bin");
});

function blank(): ChildResult {
  return {
    agent: "a",
    title: "t",
    model: "m",
    output: "",
    exitCode: 0,
    stderr: "",
    usage: emptyUsage(),
    aborted: false,
    timedOut: false,
  };
}

test("JSON イベントから、最後の報告と使用量を取り出す", () => {
  const r = blank();
  absorbEvent(r, {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "途中" }],
      usage: { input: 10, output: 2, cost: { total: 0.01 } },
    },
  });
  absorbEvent(r, {
    type: "message_end",
    message: { role: "user", content: [{ type: "text", text: "無視" }] },
  });
  absorbEvent(r, {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "最終報告" }],
      stopReason: "stop",
      usage: { input: 5, output: 3, cost: { total: 0.02 } },
    },
  });
  absorbEvent(r, { type: "message_update" });
  assert.equal(r.output, "最終報告");
  assert.deepEqual(r.usage, { turns: 2, input: 15, output: 5, cost: 0.03 });
  assert.equal(isFailed(r), false);
});

test("テキストのない最後のメッセージ(ツール呼び出し)は、報告を上書きしない", () => {
  const r = blank();
  absorbEvent(r, {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "報告" }] },
  });
  absorbEvent(r, {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "toolCall" }] },
  });
  assert.equal(r.output, "報告");
});

test("失敗の判定", () => {
  assert.equal(isFailed({ ...blank(), exitCode: 1 }), true);
  assert.equal(isFailed({ ...blank(), stopReason: "error" }), true);
  assert.equal(isFailed({ ...blank(), timedOut: true }), true);
  assert.equal(isFailed({ ...blank(), aborted: true }), true);
});

test("表示の文言", () => {
  assert.equal(
    startLine("opencode-go/deepseek-v4.1-flash", "認証の調査"),
    "⏳ サブエージェント（opencode-go/deepseek-v4.1-flash）で認証の調査を実行中",
  );
  assert.equal(doneLine("認証の調査"), "✅ 認証の調査が完了");
  assert.match(failLine("認証の調査", "時間切れ"), /^❌ 認証の調査が失敗/);
  const report = formatReport([
    { ...blank(), agent: "scout", title: "調査", output: "結果" },
    { ...blank(), title: "実装", exitCode: 1 },
  ]);
  assert.match(report, /1\/2 件が完了/);
  assert.match(report, /結果/);
});

test("同時実行数を制限し、順序を保つ", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5 * (7 - n)));
    active--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.ok(peak <= 2);
});

function fakeChild(body: string) {
  const file = path.join(tmp, `fake-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, body);
  return { command: process.execPath, prefix: [file] };
}

test("子プロセスを実行して、報告・使用量・環境変数を受け取る", async () => {
  const invocation = fakeChild(`
    const ev = (m) => console.log(JSON.stringify({ type: "message_end", message: m }));
    ev({ role: "assistant", content: [{ type: "text", text: "ENV=" + process.env.PI_SUBAGENT + ":" + process.env.PI_SUBAGENT_ROLE }],
         usage: { input: 10, output: 5, cost: { total: 0.01 } }, stopReason: "stop" });
  `);
  const r = await runChild(spec({ cwd: tmp }), { invocation, timeoutMs: 10_000 });
  assert.equal(r.output, "ENV=1:worker");
  assert.equal(r.exitCode, 0);
  assert.equal(r.usage.cost, 0.01);
  assert.equal(isFailed(r), false);
});

test("子プロセスが失敗したら、失敗として返す", async () => {
  const invocation = fakeChild("console.error('boom'); process.exit(3);");
  const r = await runChild(spec({ cwd: tmp }), { invocation, timeoutMs: 10_000 });
  assert.equal(r.exitCode, 3);
  assert.match(r.stderr, /boom/);
  assert.equal(isFailed(r), true);
});

test("時間切れで止める", async () => {
  const invocation = fakeChild("setTimeout(() => {}, 60000);");
  const r = await runChild(spec({ cwd: tmp }), { invocation, timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.equal(isFailed(r), true);
});

test("中断(abort)で止める", async () => {
  const invocation = fakeChild("setTimeout(() => {}, 60000);");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const r = await runChild(spec({ cwd: tmp }), {
    invocation,
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  assert.equal(r.aborted, true);
});
