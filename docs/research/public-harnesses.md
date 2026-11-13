# 調査: Pi のハーネスを公開している事例(拡張・パッケージ・dotfiles)

- 日付: 2026-11-13
- 出典: 調査エージェントの報告。npm の tarball の実ソース、GitHub の raw のソースと README、pi.dev/packages、awesome リスト(BubblePtr/awesome-pi ほか)を読んだもの。**私は再確認していない。**
- 人気度: GitHub のスターは、ページの表示値。月間 DL は 2026-10-13〜11-11 の npm の値。最終更新日は取得できなかったため、npm の最新版の公開日を代用した
- Pi 本体は 1.5.2。`@mariozechner/*` から `@earendil-works/*` に名前空間が変わっており、**古いパッケージは peer が旧名のままのことがある**

## 公式の最小例(`examples/extensions/`、約 70 件)
`permission-gate.ts`、`protected-paths.ts`(20 行。`tool_call` の write / edit に `{ block: true }` を返すだけ)、`plan-mode/`、`subagent/` など。**拡張は Pi と同じ OS 権限で動く**(公式の警告)。第三者のパッケージは、導入前にソースを確認する。

## 事例の一覧
「(3)」は、ルールを AGENTS.md ではなく、拡張・フックで強制しているか。

| # | 事例 | 内容 | (3) 強制 | 安全性・品質 | 人気 |
|---|---|---|---|---|---|
| 1 | [@gotgenes/pi-permission-system](https://github.com/gotgenes/pi-packages) 42.0.0(2026-10-28) | allow / ask / deny の 3 値、bash のワイルドカード規則、パス規則(.env、~/.ssh)、外部ディレクトリ、サブエージェントへの ask の転送、監査ログ | **非常に強い。** `before_agent_start` で、全拒否のツールを有効なツールから外し、毎ターン再計算。`tool_call` は 1 本の fail-closed ラッパー | bash は tree-sitter-bash で解析。`bash -c`、eval、sudo、xargs などの間接実行、解析できないコマンドは ask。symlink 解決後のパスも照合。ゲート内で例外が出たら block。サンドボックスではない。vitest、Biome、ESLint。open issue 122 件 | 280 スター、月 43.3k |
| 2 | [@aliou/pi-guardrails](https://github.com/aliou/pi-guardrails) 0.23.0(2026-11-07) | ファイル保護、ワークスペース外のアクセス制御、危険な bash の permission-gate(rm -rf、特権コマンド、ディスク整形)、設定 UI | **強い。** 3 つの独立した `tool_call` ハンドラ | 「サンドボックスではない」と明記。既定で .env、~/.ssh、~/.config/gh、gcloud、gnupg を保護。**ネットワーク通信なし**を grep で確認。peer は pi >= 1.5.0 | 306 スター、月 7.0k |
| 3 | [carderne/pi-sandbox](https://github.com/carderne/pi-sandbox) 0.8.1(2026-11-10) | read / write / edit の許可・拒否リストと、bash の OS レベルのサンドボックス | **強い(OS 層)** | 同梱の `sandbox.json` の例は緩く、README が「重大な抜け穴」と自認。**peer が pi `^0.80.0` で、1.5.x と宣言上は不一致(動作は未検証)** | 305 スター、月 7.7k |
| 4 | [kenryu42/cc-safety-net](https://github.com/kenryu42/cc-safety-net) 2.7.12(2026-11-12) | 破壊的な git、危険な rm -rf、curl\|bash、秘密ファイルへのアクセスをブロック。Claude Code、opencode、Pi 共通 | **強い。** `tool_call` で bash のコマンドを解析 | 「サンドボックスではない」と明記。**配布物はバンドル・最小化済み**で、実ソースは GitHub で確認が必要。README にアフィリエイト風のリンク | 2.0k スター、月 153.3k |
| 5 | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)(npm: mitsupi) | `goal.ts`(自律ループ)、`uv.ts`(bash の置換と python 系コマンドの制限)、todos、review、subagent、notify、session-breakdown、スキル 18 本、`/discuss` | **部分的に強い。** uv の規則は拡張で強制。goal は拡張の状態機械 | **自分の環境向け**で調整が必要と明記。`control.ts` はセッション制御のソケットを開き、`trust-github-repos.ts` は特定のオーナーのリポジトリを自動で信頼。**npm 版は古い**(peer が旧名)ので、`pi install git:github.com/mitsuhiko/agent-stuff` を使う | 3.2k スター |
| 6 | [spences10/my-pi](https://github.com/spences10/my-pi) と `@spences10/pi-*` | 約 20 パッケージ。coding-preferences(規則の DSL によるガード)、confirm-destructive、redact(出力の秘匿)、harness(タスクの契約)、observability など | **非常に強い。** `{toolNames, target: command\|path\|input\|content, pattern, reason}` を設定に書くと、`tool_call` でブロック | Semgrep の CI。ただし禁止コマンドの判定は文字列の `includes`、パスの判定は write / edit のみ。**bash 経由の書き込みは防げない**(セキュリティ境界ではなく、ドリフト防止) | 139 スター |
| 7 | [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions)(@narumitw/*) | 34 パッケージ。plan-mode、goal、subagents、usage(契約枠の取得)、accounts、worktree、notify など | **plan-mode は強い。** 「有効でない・メタデータ不明・凍結した方針の外」のツールを block。bash はコマンドを分割して安全リストで判定 | `pi-accounts`、`pi-usage`、`pi-sync` は認証情報や設定に触れる(導入前に個別に読む) | 778 スター、plan-mode は月 32.8k |
| 8 | [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) 0.88.1(2026-11-13) | 単独・連鎖・並列、スクリプト化したワークフロー、reviewer(読み取り専用)、oracle、worker、opt-in の watchdog | **強め。** 対応モデルでは、小さなローダだけが最初に見え、`subagent` ツール本体は有効化後に現れる。`maxSubagentSpawnsPerRun`(既定 64) | **配布物がバンドル**で、ソースは GitHub で確認が必要。再帰のガードや worktree 隔離は README では詳細不明 | 4.2k スター、月 931.7k |
| 9 | [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) 0.24.0(2026-11-12) | Claude Code 風の `Agent` ツール、バックグラウンド、FleetView、worktree 隔離、スケジュール | 普通(ツールとシステムプロンプトを子ごとに分ける) | `SECURITY.md` あり。open issue 62 | 1.5k スター、月 66.9k |
| 10 | [juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono)(@juicesharp/rpiv-pi) | research から verification までのパイプライン。ask-user-question(月 180.2k)、todo(月 98k)など | ワークフロー型(ゲート型ではない)。人間の判断点の強制が核 | 未精読 | 958 スター |
| 11 | [michalvavra/agents](https://github.com/michalvavra/agents)(個人の dotfiles) | AGENTS.md を各エージェントに symlink、`skills/` を配布、`agents/pi/extensions/` に cf-deploy-allowlist、**filter-output**、session-breakdown、todos | **強い。** `filter-output.ts`(142 行)は `tool_result` で、約 35 種のトークン形式、Bearer、JWT、DB の URL、秘密鍵を秘匿し、`.env` を `read` したら内容全体を置換 | OAuth のトークンを扱う拡張は自分用。**AGENTS.md は 1 行だけ**で、「ルールをコンテキストに頼らない構成」の参考になる。リポジトリ自体を Pi パッケージにし、`settings.json` の `packages` にパスを書く | 16 スター |
| 12 | [w-winter/dot314](https://github.com/w-winter/dot314) | anycopy、branch-out、**grounded-compaction**、model-aware-compaction、native-mcp-approvals など | **一部強い。** `session_before_compact` で独自の要約を作り、失敗時は `{ cancel: true }` で圧縮を止める | 「破壊的な変更を予告なく入れる」と明記 | 142 スター |
| 13 | [gentle-shell](https://www.npmjs.com/package/gentle-pi)(gentle-pi 4.7.0) | 仕様駆動開発と厳格な TDD、サブエージェント、通知、TPS 表示、voice | **子セッションに対して強い。** 環境変数 `GENTLE_PI_AGENTS_CHILD=1` の子だけに `tool_call` を登録し、破壊的コマンドを block(「UI や継承した許可でも解除できない」) | **`postinstall` が、固定版の Go バイナリを GitHub Releases から取得**(検証方法は未確認) | 月 47.3k |
| 14 | [Traveler0014/awesome-pi-agent](https://github.com/Traveler0014/awesome-pi-agent) | 自分の環境を `settings.json`、`models.json`、`pi install` の一覧で再現する**設定キット**。`npm run sync` で実環境と同期 | なし | 小規模(2 スター)。**設定の再現方法の見本** | 2 スター |
| 15 | [pi-harness-runtime](https://github.com/ManotLuijiu/pi-harness-runtime) 1.1.509 | 使用量追跡、自律ループ `/harness`、各種通知 | — | README が「Beta, Not Production Ready」。**`~/.codex/auth.json` の OAuth トークンを読み、更新し、`wham/usage` を叩く**(他のアプリの認証情報へのアクセス)。`postinstall` が設定ファイルを作成。単一の巨大ファイル(9,381 行)。**調査エージェントの判断: 導入非推奨** | 月 74.6k |

参考(未精読): `pi-vetter`(Pi パッケージの導入前の供給網審査。OSV、sigstore、tarball の差分を見て ALLOW / ASK / DENY。「安全の証明はできない」と明記)、`billion-context`(pi.dev で月 3.3M の 1 位だが、約 3 か月で **9,078 版**。ダウンロード数は品質の指標にならない)。

## 参考にする価値が高い設計トップ 5(実ソースに基づく中核機構)

### 1. @gotgenes/pi-permission-system — 「決定論的にゲートし、失敗は閉じる」
1. `before_agent_start` で、全値が deny のツールを `toolRegistry.setActive(allowedTools)` で外す。毎ターン、セッション状態の「フィルタ前のツール面」から再計算する(規則を緩めると復活する)。
2. システムプロンプトは、戻り値で返さず、`event.systemPromptOptions`(sections、skills)を**直接書き換える**。コメントによれば、戻り値のプロンプトは実行中に凍結され、後続の拡張が足したセクションが落ちるため。
3. **`tool_call` は 1 本の fail-closed ラッパー**。Pi の `emitToolCall` は例外を捕捉せず、投げると**未ゲートで実行されてしまう**ため、try / catch で `{ block: true }` に変換し、`gate_error` を監査ログに残す。
4. ポリシーは mtime で再読込、承認は session スコープ、スキルの入力は `input` イベントでゲート。

### 2. @aliou/pi-guardrails — 関心事ごとに分けた構造
1. policies(ファイル)、path-access(ワークスペース外)、permission-gate(bash)が、独立した `tool_call` ハンドラ。
2. permission-gate: 自動拒否のパターンで即座に block(`terminate` も可)→ 危険なパターンを判定 → UI がなければ block → UI があれば Allow once / Allow for session / Deny / Decline and stop → 最後は `ctx.abort()`。
3. 他の拡張が、`pi.events` のバスで判断を肩代わりできる(タイムアウト付き)。
4. 設定は global と project の 2 層で、project は信頼後のみ有効。

### 3. mitsuhiko/agent-stuff の `goal.ts` と `uv.ts` — 自律ループの最小構成と、規則の小さな実例
- **goal:** 状態を `pi.appendEntry()` で保存し、`session_start` と `session_tree` で `ctx.sessionManager.getBranch()` から復元(分岐に正しく追従)。`before_agent_start` で、active な間だけシステムプロンプトに目標を足す。`agent_end` でトークンを加算し、予算に達したら `budgetLimited`。エラー終了なら停止、abort なら UI で一時停止するか確認。それ以外は `sendMessage({ customType, display: false }, { triggerTurn: true })` で継続メッセージを積む(`continuationQueued` と `hasPendingMessages` で二重投入を防ぐ)。`context` イベントで古い継続メッセージを取り除く。モデルが使える `update_goal` は complete か blocked にしかできず、pause、resume、予算は利用者側だけ。
- **uv:** bash ツールを `createBashTool` で作り直し、`commandPrefix` で PATH にシムを足し、さらに `spawnHook` で pip、poetry、`python -m pip|venv` を正規表現で検出してエラーを投げる。PATH のシムは `.venv/bin/python` で回避できるため、起動時のチェックで塞いでいる。**AGENTS.md に書くより確実で、エラーメッセージが代替のコマンドを案内する点が秀逸。**

### 4. spences10 の pi-harness、coding-preferences と michalvavra の filter-output — 契約・規則・出力の秘匿
- **pi-harness:** 契約を `/tmp/my-pi-harness-<id>/harness.json` に置き、`tool_call` で bash の禁止コマンドと、write / edit の `allowed_paths`、`forbidden_paths`、テスト変更の可否を検査(cwd 外や symlink は `resolve` で正規化)。`before_agent_start` では、システムプロンプト全体を置換せず、`systemPromptOptions.sections.harness` という**名前つきセクションにだけ書く**(他の拡張と共存)。**完了は、モデルが `passed` と書くだけでは成立せず、拡張が受理済みの検証コマンドを実行して、契約と Git の状態が不変であることを確認する。**
- **coding-preferences:** 規則を設定ファイルに外出しし、`tool_call` で `command` / `path` / `input` / `content` を正規表現で照合。
- **filter-output:** `tool_result` で `content` と `structuredContent` を再帰的に秘匿し、機微なファイルを `read` したら中身を丸ごと置換する。**モデルの入力側で、秘密を断つ。**

### 5. carderne/pi-sandbox — OS 層で閉じる唯一の例
- `registerTool({ ...localBash, execute })` で bash を上書きし、`createBashToolDefinition(cwd, { operations: createSandboxedBashOps(...) })` で、**実行そのものをサンドボックスの中に移す**。拒否されたら、「OS サンドボックスの制限」というエラーを返し、自動で許可や再試行はしない。`user_bash`(利用者の `!` コマンド)も同じ経路に乗せる。モデル向けに `sandbox_status` と `sandbox_request_access` のツールを用意し、許可の申請を利用者の承認に回す。
- 弱点: 同梱の例が緩いこと、peer が `^0.80.0` で、1.5.x での動作が未確認。

(補足: 公式の `plan-mode` の例は、状態を `appendEntry("plan-mode", …)` で保存して `session_start` で復元する。読み取り専用は、bash の許可リスト(`isSafeCommand`)と、ツールから edit と write を外すことで実現しており、**他の拡張のツールまでは止まらない**。narumiruna 版は、「凍結したツールの方針の外は全部 block」に強化している。)

## 導入前にソースを読む価値の目安
| 区分 | 対象 | 目安 |
|---|---|---|
| 読む価値が高く、信頼しやすい | permission-system、guardrails、pi-sandbox、cc-safety-net、nicobailon と tintinweb の subagents、rpiv-mono、narumiruna の plan-mode、dot314 | 通信がない、または目的に沿う通信のみ。テストと CI、CHANGELOG あり。**ただし、全権限で動く前提は変わらない**ので、版を固定し、更新時に差分を確認する |
| 自分用に改変して使う | mitsupi(git 版)、michalvavra/agents、my-pi | 認証情報、ソケット、自動信頼を含むので、必要な拡張だけ選んで読む |
| 慎重に | gentle-pi(postinstall でバイナリを取得)、narumitw の accounts・usage・sync | 認証情報や設定に触れる、または追加のバイナリを取得する |
| 非推奨 | pi-harness-runtime | 他のアプリの OAuth トークンの読み取り、広範な外部通信、beta |
| 判断保留 | billion-context | 異常な版数と DL 数。ソース未読 |

- ダウンロード数は、実際の利用だけでなく、自動更新や CI でも膨らむ。
- 確認できなかったもの: 各リポジトリの最終コミット日、一部のスター数、tintinweb、rpiv-pi、narumitw の goal の実装の精読、nicobailon の subagents のソース(バンドルのため)。

## 我々の設計への示唆
1. **拡張の `tool_call` は、必ず fail-closed のラッパーで包む**(例外で未ゲートのまま実行される)。→ 自前のガードに採用。
2. **ツールの面を、`before_agent_start` で絞る**(拒否するツールは見せない)。→ サブエージェントの読み取り専用の役や、プラン確定後の質問ツールの除去に使う。
3. **システムプロンプトは、`systemPromptOptions` の名前つきセクションに書く**(他の拡張と共存)。→ 固定の指示の差し込みで採用。
4. **bash の文字列検査は、解析(tree-sitter-bash など)なしでは穴が多い。** 間接実行(`bash -c`、eval、xargs)は、ask に倒す。それでもサンドボックスの代わりにならない。
5. **出力側の秘匿(`tool_result`)で、モデルの入力から秘密を断つ。** → 採用。
6. **完了は、モデルの申告ではなく、拡張が検証コマンドを実行して確認する**(spences10 の pi-harness)。→ ループの完了判定で採用。
7. **子のガードは、環境変数で判別し、UI でも解除できない形にする**(gentle-shell)。→ サブエージェントのガードで採用。
8. **ルールは、エラーメッセージで代替のコマンドを案内する**(`uv.ts`)。→ ガードの拒否メッセージで採用(モデルが迷わない)。
9. **計画の状態は、`appendEntry` に保存し、`session_start` と `session_tree` で復元する。** → 採用。
10. **導入する前にソースを読み、版を固定する。** 既存のパッケージは、できるだけ導入せず、小さい自前のものを作る(今回の方針)。
