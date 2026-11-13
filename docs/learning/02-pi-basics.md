# 02 Pi の基礎: 拡張が差し込める場所

## ねらい
ハーネスは、Pi の**拡張 API** の上に作られています。この章で、Pi が提供する部品(イベント・ツール・コマンド・UI・セッションの保存)を知れば、以降のコードが読めるようになります。

## 何を作ったか(この章に対応するファイル)
- `agent/extensions/harness/index.ts`(29 行): 拡張の入口。各機能の `register...(pi, rt)` を呼ぶだけ
- `agent/extensions/harness/lib/runtime.ts`: ハーネス全体で共有する状態(`Runtime`)

```ts
// index.ts(要点)
export default function harness(pi: ExtensionAPI): void {
  const rt = createRuntime();
  registerGuards(pi, rt);        // [03] 止める
  registerInstructions(pi, rt);  // [04] 固定の指示
  registerOutput(pi, rt);        // [04] 最終行
  registerModels(pi, rt);        // [05] /models など
  registerSubagent(pi, rt);      // [06] subagent ツール
  registerFlow(pi, rt);          // [07][08] 計画・ループ
  registerGitTools(pi, rt);      // [08] PR・マージ・worktree
  registerUsage(pi, rt);         // [05] 利用状況
  registerCompaction(pi, rt);    // [09] 要約
}
```

## 仕組み

### 拡張とは
**TypeScript のモジュール**で、`export default function (pi: ExtensionAPI)` を 1 つ書きます。Pi の**同じプロセスの内部**で、Pi と同じ権限で動きます。置き場所は `~/.pi/agent/extensions/<名前>/index.ts`(自動で読み込まれ、`/reload` で再読み込み)。

### 拡張にできること(ハーネスで使っているもの)
| API | 内容 | 使っている章 |
|---|---|---|
| `pi.on("イベント", handler)` | 流れの途中に、自分のコードを差し込む | 全部 |
| `pi.registerTool(定義)` | モデルが呼べる**ツール**を足す | 06・07・08 |
| `pi.registerCommand(名前, ...)` | `/名前` の**コマンド**を足す | 05・07 |
| `pi.setActiveTools(...)` | モデルに見せるツールを、増減する | 07(確定後に `ask_user` を外す) |
| `pi.appendEntry(型, データ)` | セッションに**状態を保存**する(モデルには送られない) | 05・07 |
| `pi.sendMessage(...)` | セッションにメッセージを足す。`triggerTurn` で、新しい実行を始める | 07 |
| `pi.exec(コマンド, 引数)` | ホストで外部コマンドを実行する | 06・08 |
| `ctx.ui.select / confirm / input / notify / setStatus / setWidget` | 画面の操作 | 全部 |
| `ctx.executeTool("bash", {...})` | 別のツールを、**同じ検査(フック)を通して**呼ぶ | 08(検証・レビュー) |
| `ctx.sessionManager.getBranch()` | セッションの履歴(エントリ) | 状態の復元 |
| `ctx.modelRegistry` | 使えるモデルと認証 | 05・09 |

### 主なイベントと、1 回の依頼の流れ
Pi の公式ドキュメントにある流れのうち、ハーネスが使うものです。

```
session_start            起動、/new、/resume など
input                    ユーザーの入力(拡張が、加工・横取りできる)
before_agent_start       エージェントの実行を始める直前(システムプロンプトを変えられる)
  ┌─ turn(ツールを呼び続ける間、繰り返す)────────┐
  │ context                  モデルに送るメッセージを変えられる │
  │ tool_call                ツール実行の直前。block できる      │
  │ tool_execution_start/end ツール実行の開始・終了              │
  │ tool_result              ツールの結果。書き換えられる        │
  │ message_end              メッセージの確定。置き換えられる    │
  └───────────────────────────────────────┘
agent_end                1 回の実行が終わった(まだ続くことがある!)
agent_before_settle      本当の終わりの直前。継続を 1 回要求できる
agent_settled            本当の終わり(通知用)。中断(Esc)なら aborted: true
session_before_compact   会話の要約の直前。要約を差し替えられる
model_select             モデルが変わった
```
**重要:** `agent_end` は「終わり」ではありません。そのあとに、自動のリトライ、要約、キューのメッセージの処理が続くことがあります。**本当の終わりは `agent_settled`、継続を要求できるのは `agent_before_settle`** です(自律ループの土台。[07](07-plan-and-loop.md))。

### ツールの定義
```ts
pi.registerTool({
  name: "plan_status",
  label: "計画の状況",
  description: "モデルに見せる説明(いつ使うか)",
  parameters: Type.Object({ ... }),     // typebox(JSON Schema)
  async execute(id, params, signal, onUpdate, ctx) {
    return { content: [{ type: "text", text: "..." }], details: undefined };
  },
});
```
`description` は、**モデルが、いつ、そのツールを使うかを決める手がかり**です。書き方で、使われ方が変わります。

### セッションと状態の保存
会話は、**木構造のエントリ**として保存されます(分岐や巻き戻しができる)。ハーネスの状態(計画、`/subagent-model` の選択、worktree の一覧)は、`pi.appendEntry("harness-plan", plan)` で**エントリとして保存**し、`session_start` / `session_tree` で、`latestCustomEntry(...)` で復元します(`lib/state.ts`、11 行)。
**ファイルではなく、セッションに保存する**ので、分岐や再開に、正しく追従します。

### `Runtime`: 共有する状態(`lib/runtime.ts`)
```ts
interface Runtime {
  config, isSubagent, role, home, tmpdir, agentDir,
  ownedWorktrees, run (RunState), subagentModel, subagentModelDefault,
  subagentSpawns, childCost, plan
}
```
`isSubagent` は、環境変数 `PI_SUBAGENT=1` から決まります(子プロセスかどうか)。`run` は、「今回の依頼」の状態(成果物を作ったか、など)。

## なぜこう実装したか
- **入口を薄く**: `index.ts` は、登録するだけ。機能ごとに、`register.ts` に分けた。**機能の追加・削除が、1 行で済む**
- **共有状態を 1 つの `Runtime` にした**: グローバル変数を避け、テストでは、偽の `Runtime` を渡せる(`createRuntime({})`)
- **状態はセッションのエントリに保存**: 外部のファイルだと、分岐・再開・複数セッションで、ずれる

## Claude Code では
| 観点 | Claude Code | Pi |
|---|---|---|
| 拡張の単位 | **フック**: 設定ファイルに、「イベント → 実行するもの」を書く | **拡張**: コードの中で、`pi.on(...)` を呼ぶ |
| 動く場所 | フックは、**別プロセス**(外部コマンド)や HTTP。Claude Code とは、標準入出力と終了コードで通信 | **同じプロセスの内部**。関数を直接呼ぶ |
| 入力 | JSON(標準入力): `session_id`、`tool_name`、`tool_input`、`cwd` など | イベントのオブジェクトと、`ctx`(UI、モデル、セッションなど) |
| 出力 | 終了コード(`2` でブロック)と、JSON(`permissionDecision`、`additionalContext`、`decision: "block"`) | 戻り値(`{ block: true, reason }`、`{ message }`、`{ continue: true }` など) |
| ハンドラの種類 | `command`・`http`・`mcp_tool`・`prompt`(モデルに判断させる)・`agent`(サブエージェントに確認させる) | 拡張のコードなら何でも(モデルの呼び出しも、自分で書く) |
| ツールの追加 | MCP サーバー(別プロセス) | `registerTool`(関数) |
| 状態の保持 | フックは、毎回、別プロセスなので、状態は自分でファイルに保存 | 拡張は常駐するので、メモリ + `appendEntry` |

**トレードオフ:**
- Claude Code のフックは、**言語を選ばず、設定だけで書ける**。代わりに、毎回プロセスを起動し、状態は自分で持つ必要がある。
- Pi の拡張は、**状態を持てて、Pi の内部 API を直接使える**(強力)。代わりに、**拡張のコードは、Pi と同じ権限で動く**ので、導入前にソースを読む必要がある(公式の警告)。

Claude Code のイベント(公式ドキュメントで確認)には、`SessionStart`・`UserPromptSubmit`・`PreToolUse`・`PermissionRequest`・`PostToolUse`・`Stop`・`SubagentStop`・`PreCompact`・`PostCompact`・`SessionEnd` などがあります。Pi の `session_start`・`input`・`tool_call`・`tool_result`・`agent_before_settle`・`session_before_compact` と、**おおむね対応**します。Claude Code の `Stop` は、Pi の `agent_before_settle` に当たります。

## 試してみよう
1. `agent/extensions/harness/index.ts` の `registerModels(pi, rt);` の行を、コメントアウトして `/reload` する。`/models` コマンドが消えることを確認する(**機能が 1 行で外れる**)。元に戻す。
2. 小さな拡張を、自分で書く: `~/pi-trial/extensions/hello.ts` に、次を置いて、`/reload` し、`/hello` を実行する。
   ```ts
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
   export default function (pi: ExtensionAPI) {
     pi.registerCommand("hello", {
       description: "あいさつ",
       handler: async (_args, ctx) => ctx.ui.notify("こんにちは", "info"),
     });
   }
   ```
3. 公式のサンプル `node_modules/@earendil-works/pi-coding-agent/examples/extensions/permission-gate.ts`(約 30 行)を読み、**このハーネスの `guards/register.ts` と、どこが同じで、どこが違うか**を書き出す。

## 限界と注意
- 拡張は、**Pi と同じ権限**で動く。サンドボックスの外(未導入の今は、全部)。
- Pi の API は、更新で変わることがある(1.x でも、破壊的な変更があった)。そのため、Pi の版を固定している([../install-npm-global.md](../install-npm-global.md))。
