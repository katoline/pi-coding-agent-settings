# pi-coding-agent-settings

[Pi coding agent](https://pi.dev/) のハーネス(拡張・スキル・サブエージェントの役割・設定)を、Ubuntu PC で一から作り込み、管理するためのリポジトリです。

## 基本方針

**ルールは「コンテキスト」ではなく「ハーネス」で管理します。** 作業のルールは `AGENTS.md` に書かず、Pi の拡張のフックとツールとして実装し、仕組みで守らせます。コンテキストに書いたルールは守られ方が毎回ぶれ(非決定論)、ハーネスで強制すれば毎回同じ動きになる(決定論)ためです。

| 種類 | 実装 |
|---|---|
| **仕組みで止める・強制するもの** | `tool_call` のガード(Git、削除・プロセス、インストール、秘密情報)。**例外が起きたら必ず拒否する(fail-closed)** |
| **流れとして組み込むもの** | 計画 → 実行 → 検証 → 直して再確認 → PR・マージの自律ループ(`agent_before_settle` で継続) |
| **固定の指示として渡すもの** | 日本語の指示を、拡張が、システムプロンプトの名前つきセクション(`<harness>`)に渡す |

## できること

### コマンド
| コマンド | 内容 |
|---|---|
| `/models` | メインのモデルを選ぶ(OpenCode Go / Anthropic API の Opus 5.5・Sonnet 5.5・Fable 5.2・Haiku 5.5 / Codex)。起動時にも選ぶ |
| `/subagent-model` | サブエージェントのモデルを切り替える(既定: OpenCode Go の DeepSeek V4.1 Flash。`reset` で戻す) |
| `/plan` | 計画の状況。`/plan resume` で再開、`/plan stop` で止める |
| `/usage` | 利用状況(Anthropic API の使用額、Go・Codex の使用率) |

### ツール(モデルが使う)
| ツール | 内容 |
|---|---|
| `ask_user` | Plan の段階で、要件と判断をユーザーと確認する。**計画の確定後は、ツールから外れる(質問せずに進める)** |
| `plan_propose` / `plan_update` / `plan_note` / `plan_status` / `plan_report` | 完了条件つきのチェックリスト。**完了は、根拠・検証・レビューのゲートを通ったときだけ**。報告は状態から自動で作る |
| `harness_verify` | プロジェクトの検証コマンドを実行(`.harness/verify.json` → `check` → lint・typecheck・test・build)。無ければ「未検証」 |
| `harness_review` | 差分と要件だけを渡した、新しいコンテキストの読み取り専用のレビュー。マーカーがなければ承認としない |
| `subagent` | 独立した `pi` の子プロセスに任せる(並列可。表示は「⏳ サブエージェント（…）で…を実行中」「✅ …が完了」) |
| `harness_worktree` / `harness_pr_create` / `harness_pr_merge` / `harness_ensure_protection` | Git・GitHub の書き込みの専用ツール(メインセッションだけ) |

### 自律ループ
確定した計画に未完了の項目がある間、ユーザーに質問せずに続けます。止まる条件: 完了、中断(Esc)、キルスイッチ(`<設定ディレクトリ>/harness-off` ファイル)、継続回数・経過時間の上限、進捗のない状態の連続。項目ごとの差し戻しが **3 周で収まらない場合は、止まらずに「未完了」にして、他の項目を進め**、最後に報告します。最終応答の最後の 1 行は、必ず「🚀作業が完了しました！」になります。

### ガードの概要
- **Git:** 既定ブランチへの直接の commit・push・merge、force push、`--no-verify`、マージ済みでないリモートブランチの削除を拒否。reset --hard・clean・rebase・amend などは、ユーザーの許可制。commit・push・PR・マージは、サブエージェントからは拒否
- **削除・プロセス:** 削除は、作業ルートと一時領域の内側だけ(変数・コマンド置換で組み立てたパス、`cd` との組み合わせ、`xargs` 経由は拒否)。`pkill` / `killall` は拒否、`kill` は PID 指定と `kill $(lsof -ti :ポート)` だけ
- **インストール:** `sudo` は実行させない。`apt`・`npm install -g`・`nix profile`・`home-manager switch` などは許可制。グローバル環境(ubuntu-dotfiles)の変更も許可制
- **秘密情報:** `.env`・秘密鍵・トークンの読み取り・出力・コミットを拒否し、ツールの出力から秘密を秘匿する
- **ブランチ保護:** 初めての push の前に、GitHub の既定ブランチが保護されているかを確認し、なければ(確認のうえ)ルールセットを作る

## 導入

前提: Node.js 22.19 以上、Pi(npm グローバル。版は固定して、手動で更新する。[docs/install-npm-global.md](docs/install-npm-global.md))、`git`、`gh`。

```bash
git clone https://github.com/katoline/pi-coding-agent-settings
cd pi-coding-agent-settings
npm ci --ignore-scripts   # 開発用(テスト・型検査)。配置だけなら不要
scripts/install.sh --dry-run
scripts/install.sh
```

`scripts/install.sh` は、拡張・役割・スキル・設定を、`~/.pi/agent`(または `PI_CODING_AGENT_DIR`)に**シンボリックリンク**で配置します。既存のファイルは上書きせず、競合として失敗します。`auth.json`(API キー・OAuth トークン)には触れず、このリポジトリにも置きません。

### 設定の上書き
`<Pi の設定ディレクトリ>/harness.json` で、[config.default.json](agent/extensions/harness/config.default.json) の値を上書きできます(作業ルート、保護するパス、起動時のモデル選択、サブエージェントの上限、要約のモデルなど)。

## 構成

```
agent/                         ~/.pi/agent に配置するもの
├── extensions/harness/        ハーネス本体(拡張)
│   ├── guards/                仕組みで止めるもの(git・fs・install・secrets と、Pi への接続)
│   ├── flow/                  計画・自律ループ・検証・レビュー・PR・マージ・worktree
│   ├── subagent/              サブエージェント(別プロセス方式)
│   ├── models/  usage/  compaction/  output/  instructions/  lib/
│   └── config.default.json
├── agents/                    scout / planner / worker / reviewer(日本語)
├── skills/nix-setup/          Nix + Biome + Dependabot + CI を 1 つにしたスキル
└── settings.json              enabledModels
scripts/install.sh             配置スクリプト
tests/                         ユニットテストと、実際の Pi を使う統合テスト
docs/                          設計資料・決定記録・調査
```

## 開発と検証

```bash
npm run check   # biome + tsc + テスト(統合テストを含む)
```

統合テスト(`tests/e2e.test.ts`)は、実際の Pi 1.5.2 を RPC モードで起動し、偽のモデル(OpenAI 互換のローカルサーバー)に台本どおりのツール呼び出しをさせて、ガードの拒否、計画の確定、自律ループの継続、サブエージェントの子プロセス、最終行を通しで確かめます。ネットワークは使いません。

## 未実装・未検証(正直な現状)

- **サンドボックスは未実装です。** bash はホストで動き、ガードは、コマンドの文字列の検査です。`python -c` やスクリプト経由の間接実行は検査をすり抜けます。**OS・VM の境界の代わりにはなりません。** 方式の検討は [docs/sandbox-options.md](docs/sandbox-options.md)、[docs/research/sandbox-practices.md](docs/research/sandbox-practices.md)(公式の `sandbox/` サンプルは Pi 1.5.0 で削除済み。現在の公式は Gondolin / Docker 系)
- 実際の LLM、実際の GitHub(ルールセットの作成、PR、マージ)、Go・Codex の使用率の取得(非公式のエンドポイント)は、**実機では未検証**です。応答の形は、既存パッケージのソースで確認し、パーサーはユニットテストしています
- 独立レビューは、レビュー担当が末尾のマーカーを書く前提です。差分の中の指示に従わせない指示はありますが、プロンプトインジェクションへの完全な対策ではありません
- サブエージェントの方式は、別プロセス方式(暫定)です([docs/subagent-design.md](docs/subagent-design.md))

## 設計資料

| 資料 | 内容 |
|---|---|
| [docs/source/pi-harness-requirements.md](docs/source/pi-harness-requirements.md) | 要件の原文 |
| [docs/decisions/](docs/decisions/) | 決定記録(1 件 1 ファイル) |
| [docs/open-questions.md](docs/open-questions.md) | 未決事項 |
| [docs/feasibility-assessment.md](docs/feasibility-assessment.md) | 要件と Pi の公式ドキュメントの照合 |
| [docs/learning/](docs/learning/) | **学習教材**(各機能の実装・理由・Claude Code との比較、oh-my-pi を試す手順) |
| [docs/research/](docs/research/) | 先行事例の調査(自律ループ・実践者・サンドボックス・公開されているハーネス) |
