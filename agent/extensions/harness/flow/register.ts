import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Runtime } from "../lib/runtime.ts";
import { latestCustomEntry } from "../lib/state.ts";
import { fsReader, parseNul, workingTreeFingerprint } from "./fingerprint.ts";
import { completionMessage, continuationMessage, decideContinuation } from "./loop.ts";
import {
  addDecision,
  clonePlan,
  DEFAULT_LIMITS,
  isComplete,
  openItems,
  type Plan,
  pausePlan,
  proposePlan,
  recordReview,
  recordRework,
  recordVerification,
  renderChecklist,
  resumePlan,
  type UpdateInput,
  updateItem,
} from "./plan.ts";
import { renderReport } from "./report.ts";
import { buildRereviewNote, buildReviewTask, parseVerdict } from "./review.ts";
import { detectVerifyCommands, summarizeOutput } from "./verify.ts";

const PLAN_ENTRY = "harness-plan";
const ASK_USER = "ask_user";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: undefined });
const outcomeText = (o: { result: { content: { type: string; text?: string }[] } }) =>
  o.result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");

/**
 * 計画・自律ループ・検証・独立レビュー。メインエージェントだけが使う(サブエージェントには登録しない)。
 *
 * - Plan: `ask_user` で、要件と判断をすべてユーザーと確認し、`plan_propose` で確定する。
 *   確定したら、`ask_user` をツールから外す(確定後は質問せずに進める)。
 * - Do/Check/Act: `plan_update` の完了は、根拠・検証・レビューのゲートを通ったときだけ。
 * - ループ: `agent_before_settle` で、未完了の項目がある間、継続を要求する。上限・無進捗・中断・
 *   キルスイッチで止まる。
 */
export function registerFlow(pi: ExtensionAPI, rt: Runtime): void {
  if (rt.isSubagent) return;

  const limits = DEFAULT_LIMITS;
  const killSwitchPath = path.join(rt.agentDir, "harness-off");
  let completionPrompted = false;

  rt.run.openItems = () => (rt.plan ? openItems(rt.plan).length : 0);

  // ---- 状態の保存・復元 ----
  function syncTools() {
    const active = pi.getActiveTools();
    const autonomous = rt.plan?.confirmed === true && !isComplete(rt.plan);
    const has = active.includes(ASK_USER);
    // 確定後は、質問のツールを外す(質問せずに進める)。完了後・計画なしでは戻す
    if (autonomous && has) pi.setActiveTools(active.filter((n) => n !== ASK_USER));
    if (!autonomous && !has) pi.setActiveTools([...active, ASK_USER]);
  }

  function showStatus(ctx: ExtensionContext) {
    const plan = rt.plan;
    if (!plan?.confirmed) {
      ctx.ui.setStatus("harness-plan", undefined);
      return;
    }
    const done = plan.items.filter((i) => i.status === "done").length;
    const mark = plan.paused ? " ⏸" : isComplete(plan) ? " ✔" : " ▶";
    ctx.ui.setStatus("harness-plan", `計画 ${done}/${plan.items.length}${mark}`);
  }

  function save(plan: Plan, ctx: ExtensionContext) {
    rt.plan = plan;
    pi.appendEntry(PLAN_ENTRY, plan);
    syncTools();
    showStatus(ctx);
  }

  function restore(ctx: ExtensionContext) {
    const saved = latestCustomEntry<Plan>(ctx.sessionManager.getBranch(), PLAN_ENTRY);
    rt.plan = saved?.version === 1 ? saved : undefined;
    syncTools();
    showStatus(ctx);
  }

  async function gitRoot(ctx: ExtensionContext): Promise<string | null> {
    const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
      cwd: ctx.cwd,
      timeout: 5000,
    });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /** 作業ツリーの指紋。git のリポジトリの外では、常に同じ値(変更の検出はできない) */
  async function fingerprint(ctx: ExtensionContext): Promise<string> {
    const root = await gitRoot(ctx);
    if (!root) return "no-repo";
    const r = await pi.exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: root,
        timeout: 15000,
      },
    );
    if (r.code !== 0) return "no-repo";
    return workingTreeFingerprint({
      listFiles: async () => parseNul(r.stdout),
      read: fsReader(root),
    });
  }

  // ---- Plan: 確認と確定 ----
  pi.registerTool({
    name: ASK_USER,
    label: "ユーザーに質問",
    description:
      "Plan の段階で、要件・完了条件・判断の基準・迷ったときの扱い・細かい仕様の選択を、ユーザーと確認する。計画が確定したあとは、このツールは使えない(質問せずに進める)。",
    parameters: Type.Object({
      question: Type.String({ description: "質問(1 つの論点に絞る)" }),
      options: Type.Optional(
        Type.Array(Type.String(), { description: "選択肢。なければ、自由な入力" }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI)
        return text(
          "対話の画面がないため、ユーザーに質問できません。妥当な既定で進め、plan_note で記録してください。",
        );
      const answer = params.options?.length
        ? await ctx.ui.select(params.question, params.options)
        : await ctx.ui.input(params.question);
      return text(
        answer ? `ユーザーの回答: ${answer}` : "ユーザーは回答しませんでした(キャンセル)。",
      );
    },
  });

  pi.registerTool({
    name: "plan_propose",
    label: "計画を提出",
    description:
      "要件と判断をユーザーと確認し終えたら、完了条件つきのチェックリストを提出する。付随作業(検証、独立レビュー、記録や README、PR、マージ)も項目に入れる。ユーザーが確定すると、以後は、質問せずに完了まで進める。",
    parameters: Type.Object({
      goal: Type.String({ description: "目的(1〜2 文)" }),
      items: Type.Array(
        Type.Object({
          id: Type.String({ description: "短い識別子(例: 1、api、readme)" }),
          title: Type.String(),
          acceptance: Type.String({
            description: "完了条件。確認できる形で(コマンド、ファイル、挙動)",
          }),
          kind: Type.Optional(
            Type.Union([Type.Literal("change"), Type.Literal("task")], {
              description:
                "change: ファイルを変更する(検証が必要)/ task: 調査・記録など。既定は change",
            }),
          ),
          review: Type.Optional(
            Type.Boolean({ description: "挙動に関わる変更で、独立レビューが必要なら true" }),
          ),
        }),
        { minItems: 1 },
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const proposed = proposePlan(params.goal, params.items, Date.now());
      if (!proposed.ok) return text(`計画を受け付けられません: ${proposed.error}`);
      if (!ctx.hasUI) return text("対話の画面がないため、計画をユーザーに確認できません。");
      const choice = await ctx.ui.select(`計画の確認\n\n${renderChecklist(proposed.value)}`, [
        "確定する",
        "修正を依頼する",
        "中止する",
      ]);
      if (choice === "修正を依頼する") {
        const feedback = await ctx.ui.input("修正の指示");
        return text(
          `ユーザーが修正を求めています: ${feedback ?? "(指示なし)"}\n確認し直して、plan_propose を出し直してください。`,
        );
      }
      if (choice !== "確定する")
        return text(
          "ユーザーが計画を確定しませんでした。作業を始めずに、ユーザーの指示を待ってください。",
        );
      completionPrompted = false;
      save({ ...proposed.value, confirmed: true }, ctx);
      rt.run.planCompleted = false;
      return text(
        `計画が確定しました。以後は、ユーザーに質問せず、完了まで進めてください(ask_user は使えなくなりました)。\n\n${renderChecklist(proposed.value)}`,
      );
    },
  });

  // ---- Do: 項目の更新 ----
  pi.registerTool({
    name: "plan_update",
    label: "計画の項目を更新",
    description:
      "項目の状態を更新する。done は、根拠(evidence)が必要。変更を伴う項目は、最後の変更のあとに harness_verify が通っていること、レビューが必要な項目は harness_review が承認されていることが要る。ユーザーにしかできないこと(sudo、秘密情報の用意など)は、deferred(理由つき)で保留にして、他の項目を進める。",
    parameters: Type.Object({
      id: Type.String(),
      status: Type.Union([
        Type.Literal("in_progress"),
        Type.Literal("done"),
        Type.Literal("deferred"),
      ]),
      evidence: Type.Optional(
        Type.String({ description: "done の根拠(file:line、コマンドの出力)" }),
      ),
      reason: Type.Optional(Type.String({ description: "deferred の理由" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!rt.plan) return text("計画がありません。");
      let update: UpdateInput;
      if (params.status === "done") update = { status: "done", evidence: params.evidence ?? "" };
      else if (params.status === "deferred")
        update = { status: "deferred", reason: params.reason ?? "" };
      else update = { status: "in_progress" };
      const result = updateItem(rt.plan, params.id, update, {
        fingerprint: await fingerprint(ctx),
      });
      if (!result.ok) return text(`更新できません: ${result.error}`);
      save(result.value, ctx);
      const tail = isComplete(result.value)
        ? "\n\nすべての項目が済みました。plan_report を呼んで、完了報告を出してください。"
        : "";
      return text(`更新しました。\n\n${renderChecklist(result.value)}${tail}`);
    },
  });

  pi.registerTool({
    name: "plan_note",
    label: "判断を記録",
    description:
      "計画で決めていない判断を、計画の方針に沿う妥当な既定で進めたときに、その内容を記録する(完了報告の「自分で判断したこと」に載る)。",
    parameters: Type.Object({ note: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!rt.plan) return text("計画がありません。");
      save(addDecision(rt.plan, params.note), ctx);
      return text("記録しました。");
    },
  });

  pi.registerTool({
    name: "plan_status",
    label: "計画の状況",
    description: "チェックリストの現在の状況を見る。",
    parameters: Type.Object({}),
    async execute() {
      return text(rt.plan ? renderChecklist(rt.plan) : "計画がありません。");
    },
  });

  pi.registerTool({
    name: "plan_report",
    label: "完了報告",
    description:
      "すべての項目が済んだら、固定の形の完了報告を作る。その出力を、そのまま最終の報告として書く。",
    parameters: Type.Object({}),
    async execute() {
      if (!rt.plan) return text("計画がありません。");
      if (!isComplete(rt.plan)) {
        return text(
          `未着手・進行中の項目が残っています。続けてください。\n\n${renderChecklist(rt.plan)}`,
        );
      }
      rt.run.planCompleted = true;
      return text(renderReport(rt.plan));
    },
  });

  // ---- Check: 検証 ----
  async function runBashTool(
    ctx: ExtensionToolContext,
    command: string,
    signal: AbortSignal | undefined,
  ) {
    return ctx.executeTool("bash", { command, timeout: 600 }, signal ? { signal } : undefined);
  }

  pi.registerTool({
    name: "harness_verify",
    label: "検証",
    description:
      "プロジェクトの検証コマンド(lint・型チェック・テスト・ビルド)を実行する。変更のあとに必ず実行する。コマンドは、.harness/verify.json、package.json の check、lint・typecheck・test・build の順に決まる。見つからなければ「未検証」として記録され、自動マージはしない。テストの skip・削除や、ルールの無効化で通すことは禁止。",
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _onUpdate, ctx) {
      const root = (await gitRoot(ctx)) ?? ctx.cwd;
      const commands = detectVerifyCommands({
        read: (f) => {
          try {
            return readFileSync(path.join(root, f), "utf8");
          } catch {
            return null;
          }
        },
        exists: (f) => existsSync(path.join(root, f)),
      });
      const fp = await fingerprint(ctx);
      if (commands.length === 0) {
        if (rt.plan) {
          save(
            recordVerification(rt.plan, {
              command: "(検証コマンドなし)",
              ok: true,
              unverified: true,
              fingerprint: fp,
              summary: "検証コマンドが見つかりません",
            }),
            ctx,
          );
        }
        return text(
          "検証コマンドが見つかりません。**未検証**として記録しました(完了報告に「未検証」と書かれ、自動マージはしません)。.harness/verify.json に commands を書くと、検証できます。",
        );
      }
      const lines: string[] = [];
      let allOk = true;
      for (const command of commands) {
        const outcome = await runBashTool(ctx, command, signal);
        const ok = !outcome.isError;
        allOk &&= ok;
        lines.push(
          `${ok ? "成功" : "失敗"}: ${command}${ok ? "" : `\n${summarizeOutput(outcomeText(outcome))}`}`,
        );
      }
      const summary = lines.join("\n");
      let message = `${allOk ? "検証に成功しました" : "検証に失敗しました。直して、やり直してください"}\n\n${summary}`;
      if (rt.plan) {
        let plan = recordVerification(rt.plan, {
          command: commands.join(" && "),
          ok: allOk,
          fingerprint: fp,
          summary: allOk ? `${commands.length} コマンドが成功` : summarizeOutput(summary, 300),
        });
        if (!allOk) {
          const rework = recordRework(plan, "検証の失敗", limits);
          plan = rework.plan;
          for (const item of rework.gaveUp) {
            message += `\n\n項目 ${item.id} は、${item.cycles} 周で収まらなかったため、未完了にしました。他の項目を進めてください。`;
          }
        }
        save(plan, ctx);
      }
      return text(message);
    },
  });

  // ---- Check: 独立レビュー ----
  async function diffAgainstBase(
    ctx: ExtensionContext,
  ): Promise<{ baseRef: string; stat: string; diff: string } | null> {
    const root = await gitRoot(ctx);
    if (!root) return null;
    const run = async (args: string[]) => {
      const r = await pi.exec("git", args, {
        cwd: root,
        timeout: 30000,
        maxBuffer: 32 * 1024 * 1024,
      });
      return r.code === 0 ? r.stdout : "";
    };
    const originHead = (await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    const defaultRef = originHead || "origin/main";
    const mergeBase = (await run(["merge-base", "HEAD", defaultRef])).trim();
    const baseRef = mergeBase || "HEAD";
    const stat = await run(["diff", "--stat", baseRef]);
    let diff = await run(["diff", baseRef]);
    const untracked = parseNul(await run(["ls-files", "--others", "--exclude-standard", "-z"]));
    for (const file of untracked.slice(0, 50)) {
      try {
        const body = readFileSync(path.join(root, file), "utf8").slice(0, 20000);
        diff += `\n+++ 新規ファイル: ${file}\n${body
          .split("\n")
          .map((l) => `+${l}`)
          .join("\n")}\n`;
      } catch {
        // 読めないファイルは省く
      }
    }
    return {
      baseRef: mergeBase ? `${defaultRef}(merge-base ${mergeBase.slice(0, 8)})` : "HEAD",
      stat,
      diff,
    };
  }

  pi.registerTool({
    name: "harness_review",
    label: "独立レビュー",
    description:
      "挙動に関わる変更を、新しいコンテキストの読み取り専用のレビュー担当に、差分と要件だけを渡してレビューさせる(ドキュメントのみ・数行の自明な修正は不要)。末尾のマーカーで判定し、マーカーがない・エラーは承認にならない。採否は、メインエージェントが判断する。再レビューは、直した差分だけを対象にする。",
    parameters: Type.Object({
      requirements: Type.Optional(
        Type.String({ description: "要件。省略すると、計画の完了条件を使う" }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const material = await diffAgainstBase(ctx);
      if (!material) return text("git のリポジトリの外では、差分を作れません。");
      if (!material.diff.trim()) return text("差分がありません。レビューの対象がありません。");
      const requirements =
        params.requirements?.trim() ||
        (rt.plan
          ? rt.plan.items
              .map((i) => `- ${i.id}: ${i.title}\n  完了条件: ${i.acceptance}`)
              .join("\n")
          : "");
      if (!requirements)
        return text("要件がありません。requirements を渡すか、計画を確定してください。");
      const previous = rt.plan?.reviews.at(-1);
      let task = buildReviewTask({
        requirements,
        baseRef: material.baseRef,
        diffStat: material.stat,
        diff: material.diff,
      });
      if (previous && !previous.approved) task += buildRereviewNote(previous.summary);
      const fp = await fingerprint(ctx);
      const outcome = await ctx.executeTool(
        "subagent",
        { tasks: [{ agent: "reviewer", title: "独立レビュー", task }] },
        signal ? { signal } : undefined,
      );
      const output = outcomeText(outcome);
      const verdict = outcome.isError ? "none" : parseVerdict(output);
      const approved = verdict === "approved";
      let message = `${approved ? "レビューは承認されました。" : verdict === "disapproved" ? "レビューで指摘がありました。採否を判断し、直す指摘は直して、再レビューを受けてください(直さない指摘は、理由を添えて「対象外」として記録します)。" : "レビューの判定を得られませんでした(マーカーなし、またはエラー)。承認とは扱いません。"}\n\n${output}`;
      if (rt.plan) {
        let plan = recordReview(rt.plan, {
          approved,
          fingerprint: fp,
          summary: summarizeOutput(output, 500),
        });
        if (!approved) {
          const rework = recordRework(plan, "レビューの差し戻し", limits);
          plan = rework.plan;
          for (const item of rework.gaveUp) {
            message += `\n\n項目 ${item.id} は、${item.cycles} 周で収まらなかったため、未完了にしました。他の項目を進めてください。`;
          }
        }
        save(plan, ctx);
      }
      return text(message);
    },
  });

  // ---- 自律ループ ----
  function request(
    ctx: ExtensionContext,
    plan: Plan,
    entries: unknown[],
    content: string,
    customType: string,
  ) {
    save(plan, ctx);
    return {
      entries: [
        ...entries,
        { type: "custom_message" as const, customType, content, display: false },
      ],
      continue: true,
    };
  }

  pi.on("agent_before_settle", async (event, ctx) => {
    const plan = rt.plan;
    const decision = decideContinuation({
      plan,
      now: Date.now(),
      limits,
      killSwitch: existsSync(killSwitchPath),
    });
    if (decision.continue) {
      return request(
        ctx,
        decision.plan,
        event.entries,
        decision.message,
        "harness-continue",
      ) as never;
    }
    if (decision.reason === "limit") {
      save(decision.plan, ctx);
      ctx.ui.notify(
        `自律ループを止めました: ${decision.detail}\n/plan resume で再開できます。`,
        "warning",
      );
      return undefined;
    }
    if (decision.reason === "complete" && plan && !completionPrompted && !rt.run.planCompleted) {
      completionPrompted = true;
      return request(ctx, plan, event.entries, completionMessage(), "harness-complete") as never;
    }
    return undefined;
  });

  // 中断(Esc)では継続しない。一時停止にして、再開できるようにする
  pi.on("agent_settled", async (event, ctx) => {
    const plan = rt.plan;
    if (event.aborted && plan?.confirmed && !isComplete(plan) && !plan.paused) {
      save(pausePlan(plan, "中断(Esc)"), ctx);
      ctx.ui.notify(
        "中断したため、自律ループを一時停止しました。/plan resume で再開できます。",
        "info",
      );
    }
  });

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  // 圧縮や長い会話のあとでも、計画を見失わないよう、毎回システムプロンプトに載せる
  pi.on("before_agent_start", async (event) => {
    const plan = rt.plan;
    if (plan?.confirmed && !isComplete(plan)) {
      const options = event.systemPromptOptions;
      options.sections = {
        ...(options.sections ?? {}),
        harness_plan: `確定済みの計画(状態):\n${renderChecklist(plan)}`,
      };
    }
    return undefined;
  });

  pi.registerCommand("plan", {
    description: "計画の状況を見る。/plan resume で再開、/plan stop で止める",
    handler: async (args, ctx) => {
      const sub = args.trim();
      const plan = rt.plan;
      if (!plan) {
        ctx.ui.notify("計画はありません。", "info");
        return;
      }
      if (sub === "resume") {
        if (isComplete(plan)) {
          ctx.ui.notify("計画は、すべて済んでいます。", "info");
          return;
        }
        const resumed = resumePlan(plan);
        save(resumed, ctx);
        pi.sendMessage(
          { customType: "harness-continue", content: continuationMessage(resumed), display: false },
          { triggerTurn: true },
        );
        ctx.ui.notify("自律ループを再開しました。", "info");
        return;
      }
      if (sub === "stop") {
        save(pausePlan(plan, "ユーザーが止めました"), ctx);
        ctx.ui.notify("自律ループを止めました。/plan resume で再開できます。", "info");
        return;
      }
      ctx.ui.notify(
        `${renderChecklist(clonePlan(plan))}${plan.paused ? `\n\n一時停止中: ${plan.pausedReason ?? ""}` : ""}`,
        "info",
      );
    },
  });
}
