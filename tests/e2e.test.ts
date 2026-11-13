/**
 * 統合テスト: 実際の Pi(node_modules の 1.5.2)を RPC モードで起動し、偽のモデル
 * (OpenAI 互換のローカルサーバー)につないで、ハーネスを通しで確かめる。
 *
 * 確かめること: 拡張の読み込み、ガードによる拒否、計画の確定、自律ループの継続、確定後の
 * ask_user の除去、完了報告、最終行の付与。ネットワークは使わない。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FINAL_LINE } from "../agent/extensions/harness/output/final-line.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const piCli = path.join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const extension = path.join(root, "agent/extensions/harness/index.ts");

type Step = { text: string } | { tool: string; args: unknown };
const steps: Step[] = [
  { tool: "bash", args: { command: "git push --force origin main" } }, // 0: ガードが拒否する
  {
    tool: "plan_propose",
    args: {
      goal: "テスト",
      items: [{ id: "1", title: "調査", acceptance: "README を確認した", kind: "task" }],
    },
  }, // 1: ユーザーが確定する
  { tool: "plan_update", args: { id: "1", status: "in_progress" } }, // 2
  { text: "着手しました" }, // 3: 未完了なので、ハーネスが継続を要求する
  { tool: "plan_update", args: { id: "1", status: "done", evidence: "README.md:1" } }, // 4
  { text: "全部終わりました" }, // 5: 完了報告を促す継続
  { tool: "plan_report", args: {} }, // 6
  { text: "報告します" }, // 7: 最終応答。最終行が付く
];

interface Seen {
  messages: string;
  tools: string[];
}
const requests: Seen[] = [];

function sse(res: http.ServerResponse, step: Step, n: number) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const base = {
    id: `chatcmpl-${n}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "mock-1",
  };
  if ("text" in step) {
    send({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    });
    send({ ...base, choices: [{ index: 0, delta: { content: step.text }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  } else {
    send({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${n}`,
                type: "function",
                function: { name: step.tool, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    send({
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(step.args) } }] },
          finish_reason: null,
        },
      ],
    });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  }
  send({
    ...base,
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}") as {
      messages?: unknown;
      tools?: { function?: { name?: string } }[];
    };
    const n = requests.length;
    requests.push({
      messages: JSON.stringify(parsed.messages ?? []),
      tools: (parsed.tools ?? []).map((t) => t.function?.name ?? ""),
    });
    sse(res, steps[n] ?? { text: "(終了)" }, n);
  });
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "harness-e2e-"));
after(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("実際の Pi で、ガード・計画・自律ループ・最終行が動く", { timeout: 120_000 }, async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const agentDir = path.join(tmp, "agent");
  const cwd = path.join(tmp, "work");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: "dummy",
          models: [{ id: "mock-1", name: "Mock" }],
        },
      },
    }),
  );
  writeFileSync(
    path.join(agentDir, "harness.json"),
    JSON.stringify({ selectModelOnStartup: false }),
  );

  const proc = spawn(
    process.execPath,
    [
      piCli,
      "--mode",
      "rpc",
      "--offline",
      "--no-session",
      "--no-skills",
      "--no-prompt-templates",
      "--no-mcp",
      "--no-extensions",
      "-e",
      extension,
      "--model",
      "mock/mock-1",
    ],
    {
      cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d;
  });

  const toolResults: { name: string; text: string; isError: boolean }[] = [];
  const assistantTexts: string[] = [];
  const uiTitles: string[] = [];
  let settled = false;
  let buffer = "";

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`時間切れ\nstderr: ${stderr}\nrequests: ${requests.length}`)),
      100_000,
    );
    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "extension_ui_request") {
          const id = String(ev.id);
          const method = String(ev.method);
          if (method === "select" || method === "confirm" || method === "input") {
            uiTitles.push(String(ev.title ?? ""));
            const reply =
              method === "select" && String(ev.title).includes("計画の確認")
                ? { type: "extension_ui_response", id, value: "確定する" }
                : { type: "extension_ui_response", id, cancelled: true };
            proc.stdin.write(`${JSON.stringify(reply)}\n`);
          }
        }
        if (ev.type === "tool_execution_end") {
          const result = ev.result as { content?: { type: string; text?: string }[] } | undefined;
          toolResults.push({
            name: String(ev.toolName),
            text: (result?.content ?? []).map((c) => c.text ?? "").join("\n"),
            isError: Boolean(ev.isError),
          });
        }
        if (ev.type === "message_end") {
          const m = ev.message as
            | { role?: string; content?: { type: string; text?: string }[] }
            | undefined;
          if (m?.role === "assistant") {
            assistantTexts.push(
              (m.content ?? [])
                .filter((c) => c.type === "text")
                .map((c) => c.text ?? "")
                .join("\n"),
            );
          }
        }
        if (ev.type === "agent_settled" && requests.length >= steps.length) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      }
    });
    proc.on("exit", (code) => {
      if (!settled) reject(new Error(`Pi が終了しました(${code})\nstderr: ${stderr}`));
    });
  });

  proc.stdin.write(`${JSON.stringify({ type: "prompt", message: "作業してください" })}\n`);
  try {
    await done;
  } finally {
    proc.kill("SIGTERM");
  }

  const resultOf = (name: string) => toolResults.filter((r) => r.name === name);

  // 1. ガード: force push は、実行されずに拒否される(理由がモデルに返る)
  const bash = resultOf("bash")[0];
  assert.ok(bash, "bash の結果があるはず");
  assert.equal(bash.isError, true);
  assert.match(bash.text, /force push は禁止/);

  // 2. 計画: ユーザーに確認し、確定する
  assert.ok(uiTitles.some((t) => t.includes("計画の確認")));
  assert.match(resultOf("plan_propose")[0]?.text ?? "", /計画が確定しました/);

  // 3. 自律ループ: 未完了のまま応答が終わっても、ハーネスが継続を要求する(ユーザーの入力なしで)
  assert.ok(
    requests[4]?.messages.includes("確定した計画は、まだ完了していません"),
    "継続のメッセージがモデルに渡る",
  );
  assert.ok(requests[4]?.messages.includes("次に取り組む項目: 1"));

  // 4. 確定後は ask_user が使えない。確定前は使える
  assert.ok(requests[0]?.tools.includes("ask_user"), "確定前は ask_user がある");
  assert.ok(!requests[4]?.tools.includes("ask_user"), "確定後は ask_user を外す");
  assert.ok(requests[0]?.tools.includes("plan_propose"));
  assert.ok(requests[0]?.tools.includes("harness_verify"));

  // 5. 完了: すべての項目が済んだら、完了報告を促し、固定の形の報告を作る
  assert.ok(
    requests[6]?.messages.includes("完了報告") || requests[6]?.messages.includes("plan_report"),
  );
  const report = resultOf("plan_report")[0]?.text ?? "";
  for (const s of ["完了報告", "要件ごとの結果", "根拠: README.md:1", "未検証"])
    assert.ok(report.includes(s), s);

  // 6. 最終応答の最後の 1 行が、完了の 1 行になる
  const last = assistantTexts.filter((t) => t.trim()).at(-1) ?? "";
  assert.equal(last.trimEnd().split("\n").at(-1), FINAL_LINE);
  assert.ok(last.startsWith("報告します"));
  // 途中の応答には付かない
  assert.ok(!assistantTexts[3]?.includes(FINAL_LINE));
});
