import assert from "node:assert/strict";
import { test } from "node:test";
import { latestCustomEntry } from "../agent/extensions/harness/lib/state.ts";
import {
  groupModels,
  parseRef,
  refToString,
  SUBAGENT_DEFAULT,
} from "../agent/extensions/harness/models/catalog.ts";

const m = (provider: string, id: string) => ({ provider, id });

test("使えるモデルを 3 つのグループに分ける", () => {
  const groups = groupModels(
    [
      m("opencode-go", "deepseek-v4.1-flash"),
      m("opencode-go", "glm-5.2"),
      m("anthropic", "claude-haiku-5-5"),
      m("anthropic", "claude-opus-5-5"),
      m("anthropic", "claude-3-haiku"), // 一覧の 4 つ以外は出さない
      m("anthropic", "claude-fable-5-2"),
      m("anthropic", "claude-sonnet-5-5"),
      m("openai-codex", "gpt-6.1-sol"),
      m("openai", "gpt-6.1-sol"),
      m("openrouter", "x"),
    ],
    (x) => x.provider === "openai",
  );
  assert.deepEqual(
    groups.map((g) => g.key),
    ["opencode-go", "anthropic", "codex"],
  );
  assert.deepEqual(
    groups[0]?.models.map((x) => x.id),
    ["deepseek-v4.1-flash", "glm-5.2"],
  );
  // Anthropic は、Opus 5.5 / Sonnet 5.5 / Fable 5.2 / Haiku 5.5 の順
  assert.deepEqual(
    groups[1]?.models.map((x) => x.id),
    ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-haiku-5-5"],
  );
  assert.equal(groups[2]?.models.length, 2);
});

test("ChatGPT でサインインしていない openai は Codex に入れない", () => {
  const groups = groupModels([m("openai", "gpt-6.1-sol")], () => false);
  assert.equal(groups.length, 0);
});

test("認証のないプロバイダのグループは出ない", () => {
  const groups = groupModels([m("anthropic", "claude-opus-5-5")]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ["anthropic"],
  );
});

test("provider/id の解析", () => {
  assert.deepEqual(
    parseRef("opencode-go/deepseek-v4.1-flash"),
    m("opencode-go", "deepseek-v4.1-flash"),
  );
  assert.deepEqual(parseRef("openrouter/anthropic/claude"), m("openrouter", "anthropic/claude"));
  assert.equal(parseRef("noslash"), null);
  assert.equal(parseRef("/x"), null);
  assert.equal(parseRef("x/"), null);
  assert.equal(refToString(m("a", "b")), "a/b");
  assert.deepEqual(parseRef(SUBAGENT_DEFAULT), m("opencode-go", "deepseek-v4.1-flash"));
});

test("保存したカスタムエントリの、最新を取り出す", () => {
  const entries = [
    { type: "custom", customType: "x", data: { v: 1 } },
    { type: "message" },
    { type: "custom", customType: "x", data: { v: 2 } },
    { type: "custom", customType: "y", data: { v: 9 } },
  ];
  assert.deepEqual(latestCustomEntry(entries, "x"), { v: 2 });
  assert.equal(latestCustomEntry(entries, "z"), undefined);
  assert.equal(latestCustomEntry([], "x"), undefined);
});
