import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeInstructions,
  loadInstructions,
} from "../agent/extensions/harness/instructions/load.ts";
import { FINAL_LINE, withFinalLine } from "../agent/extensions/harness/output/final-line.ts";

type Block = { type: string; text?: string };
function blocks(out: { content?: unknown } | null): Block[] {
  assert.ok(out, "メッセージが書き換えられるはず");
  return out.content as Block[];
}

const assistant = (content: unknown[], stopReason = "stop") => ({
  role: "assistant",
  content,
  stopReason,
});

test("最終応答の最後に、完了の 1 行を足す", () => {
  const out = withFinalLine(assistant([{ type: "text", text: "完了しました。" }]));
  const text = blocks(out)[0]?.text ?? "";
  assert.equal(text.split("\n").at(-1), FINAL_LINE);
  assert.ok(text.startsWith("完了しました。"));
});

test("すでに最後の行が完了の 1 行なら、変更しない", () => {
  assert.equal(withFinalLine(assistant([{ type: "text", text: `報告\n\n${FINAL_LINE}\n` }])), null);
});

test("末尾の空行は整えたうえで足す", () => {
  const out = withFinalLine(assistant([{ type: "text", text: "報告\n\n\n" }]));
  assert.equal(blocks(out)[0]?.text, `報告\n\n${FINAL_LINE}`);
});

test("テキストがなければ、テキストのブロックを足す", () => {
  const out = withFinalLine(assistant([{ type: "thinking", thinking: "..." }]));
  assert.equal(blocks(out).at(-1)?.text, FINAL_LINE);
});

test("ツール呼び出しがある(まだ続く)メッセージ、エラー、中断、ユーザー発言には付けない", () => {
  assert.equal(
    withFinalLine(
      assistant([
        { type: "text", text: "x" },
        { type: "toolCall", name: "bash" },
      ]),
    ),
    null,
  );
  assert.equal(withFinalLine(assistant([{ type: "text", text: "x" }], "error")), null);
  assert.equal(withFinalLine(assistant([{ type: "text", text: "x" }], "aborted")), null);
  assert.equal(withFinalLine({ role: "user", content: [{ type: "text", text: "x" }] }), null);
});

test("最後のテキストのブロックだけを書き換え、ほかは保つ", () => {
  const out = withFinalLine(
    assistant([
      { type: "text", text: "前" },
      { type: "thinking", thinking: "t" },
      { type: "text", text: "後" },
    ]),
  );
  const content = blocks(out);
  assert.equal(content[0]?.text, "前");
  assert.equal(content[2]?.text, `後\n\n${FINAL_LINE}`);
});

test("固定の指示は日本語で、主要な項目を含む", () => {
  const main = loadInstructions("main");
  for (const word of [
    "言語",
    "Plan",
    "Do",
    "Check",
    "Act",
    "plan_propose",
    "harness_verify",
    "harness_review",
    "harness_pr_merge",
    "レビューの範囲",
  ]) {
    assert.ok(main.includes(word), word);
  }
  assert.ok(loadInstructions("subagent").includes("変更ファイル"));
  assert.ok(composeInstructions("subagent", "あなたは reviewer です").includes("役割の指示"));
});
