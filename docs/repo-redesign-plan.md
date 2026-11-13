# このリポジトリの刷新計画

- 日付: 2026-11-13
- 状態: **実行中**。ユーザーの指示(decisions/011)により、旧設計はすべて削除し、新しい要件でゼロから作り直している。下の「引き継ぐもの」は、旧コードを流用する意味ではなく、**考え方の参照**として読むこと
- 対象: `katoline/pi-coding-agent-settings`(旧設計。ブランチ `agent/bootstrap-harness` の 1 コミット)
- 方針: ユーザーの指示により、旧設計を土台にせず、**全面的に作り直してよい**

## 1. 旧設計の要約(読み取った内容)
Pi 1.3.0 / Node 24 を前提にした、「**安全側に倒した、制限つきの開発ハーネス**」。

| 領域 | 旧設計の中身 |
|---|---|
| 起動 | `scripts/harness.mjs` が、**Docker コンテナの中で Pi を起動**する。ルートファイルシステムは読み取り専用、権限を落とし、書き込めるのは対象プロジェクトだけ。`.git` は読み取り専用の別マウント |
| ツール | 拡張 `.pi/extensions/harness.ts` が、`read`、`grep`、`find`、`ls`、`write`、`edit` と、独自の `harness_delegate`、`harness_check` **だけ**を許可する。**生のシェル(bash)と Git の書き込みは禁止** |
| 役割 | scout / planner / reviewer は読み取り専用の子プロセス(`--no-extensions -e harness.ts --tools read,grep,find,ls`)。環境変数 `PI_HARNESS_ROLE` で親子を判別。委譲の回数に上限(6 回)、タイムアウト、出力の上限がある |
| Git | `scripts/git-guard.mjs`(host 側)が commit / push / PR を行う。**検証済みのツリーを一時ディレクトリに展開し、隔離コンテナで再検証と独立レビューを通ってからコミット**。push は `agent/*` ブランチだけ。CI は「その SHA の push で `Quality` が成功」を確認。**マージはしない** |
| ルール | `AGENTS.md`(英語)に 10 項目の方針。「指示であって強制ではない」と明記 |
| 品質 | Biome、型チェック、「テストがなければ失敗」の `require-tests.mjs`、`node:test` のポリシーテスト、`Quality` ワークフロー(quality / sandbox / nix) |
| 新規プロジェクト | `init-project.mjs` と `new-project` スキル。Nix、Biome、CI を生成 |

## 2. 新しい要件との差
新しい要件は `docs/source/pi-harness-requirements.md`。決定事項は `docs/decisions/`。

| 観点 | 旧設計 | 新しい要件 | 差 |
|---|---|---|---|
| bash | **禁止**(制限ツールだけ) | **使えるが**、サンドボックスと `tool_call` ガードで守る | 方針が逆。検証コマンド、テスト、Nix を使うには bash が必要 |
| 隔離 | 自前の Docker ランチャー(Pi 全体を包む) | Pi の公式の方式(Gondolin など)。方式は確認中 | 公式の方式に寄せる。ランチャーは不要になる可能性が高い |
| ルールの置き場 | `AGENTS.md`(コンテキスト) | **ハーネス(拡張・フック・コマンド)**。AGENTS.md には書かない | `AGENTS.md` は廃止。強制するものはフックに、判断が要るものは拡張が差し込む固定の指示に |
| 言語 | 英語 | **日本語**(サブエージェントも) | 全面的に書き換え |
| マージ | **しない** | **CI が通ったら自動でマージ**(ブランチ保護が前提) | 方針が逆。ゲートの条件を作り直す |
| ブランチ | `agent/*` だけ | 既定ブランチ以外(作業ブランチ)。PR は細かく分ける | 条件を緩める。ただし既定ブランチへの直接操作は引き続き拒否 |
| プロバイダ | 設定に任せる(`models` は null) | Go / Anthropic API / Codex の 3 系統、`/models`、`/subagent-model`、使用状況の表示 | 新規 |
| サブエージェント | 読み取り専用の 3 役割のみ | worker(書き込み)も含む。既定モデルは Go の DeepSeek V4.1 Flash。表示文言、費用の合算 | 拡張 |
| 自律実行 | 「2 回失敗したら止まる」 | **計画を最後まで実行する PDCA ループ**(3 周で打ち切り、未完了は報告) | 新規。調査中(自律ループの先行事例) |
| 利用状況 | なし | Go・Codex の使用率、Anthropic のセッション費用 | 新規 |
| Nix スキル | Nix + Biome + CI | Nix + Biome + **Dependabot** + CI を 1 つのスキルに | Dependabot を追加 |
| Pi の版 | 1.3.0 を固定 | npm グローバルで導入。版は固定して手動で更新(最新は 1.5.2) | 固定する版を 1.5.2 系に更新 |
| 設定の管理 | このリポジトリ(`.pi/` は、このリポジトリで起動したときだけ効く) | `~/.pi/agent/` に配置して全プロジェクトで効かせる | 構成を `~/.pi/agent/` の形にする |

## 3. 旧設計から引き継ぐもの・捨てるもの

### 引き継ぐ(考え方、またはコードを流用する)
| 旧 | 新しい設計での使い道 |
|---|---|
| 環境変数による親子の判別(`PI_HARNESS_ROLE`) | `PI_SUBAGENT` として、そのまま採用(subagent-design.md の改造プラン 1・2) |
| 子の起動引数 `--no-extensions -e <ガードの拡張> --no-mcp --no-skills --no-prompt-templates --no-session --tools ... --append-system-prompt` | **子には必要な拡張だけを読み込ませる**考え方は有用。公式サンプルより安全で、`--no-extensions` で再帰呼び出しも防げる |
| 委譲の回数上限、タイムアウト、出力上限 | サブエージェントの予算と暴走防止にそのまま使う |
| `git-guard.mjs` の「検証済みのツリーだけをコミット」「その SHA の CI 成功を確認」「作業ツリーが clean であること」 | **「Git の書き込みはサンドボックスの外の専用ツールで行う」案の実装の土台**(sandbox-options.md の「守れないもの」の 2)。ただし、マージを許可する形に作り直す |
| `pr-body.mjs`(PR 本文の生成) | 「概要・変更点・確認方法」の固定形式に合わせて流用 |
| `quality.yml`、`biome.json`、`tsconfig.json`、`require-tests.mjs` | 流用(版は更新)。サンドボックスの job は方式しだいで削除 |
| `tests/policy.test.mjs` の方式(`node:test` でガードを検証) | 新しいガードのテストでも同じ方式を使う |
| `flake.nix` | 開発シェル用に更新して使う(Pi 自体は npm グローバルで入れる) |
| ロール定義(scout / planner / worker / reviewer)の分け方 | 日本語に書き換えて、定義の骨格として使う。モデルの指定を足す |

### 捨てる(置き換える)
| 旧 | 理由 |
|---|---|
| `AGENTS.md` | ルールをコンテキストに置かない方針。強制はフックに、固定の指示は拡張から差し込む |
| 「bash 禁止」のツール制限(`harness.ts` の許可リスト) | 新しい方針は、bash を許可してサンドボックスで守る |
| 「マージしない」の方針 | CI が通ったら自動でマージする方針に変わった |
| Docker ランチャー(`harness.mjs`、`container-start.mjs`、`lib.mjs` の `sandboxArgs`、`Dockerfile`、`sandbox-smoke`) | サンドボックスの方式しだい。公式の Gondolin を選ぶなら不要。Docker を選ぶなら、公式のガイドに合わせて作り直す |
| `.pi/prompts/implement.md`(英語の 1 段落の指示) | PDCA と固定の指示は、拡張から差し込む日本語の指示に置き換える |
| `init-project.mjs` の現在の形 | Nix セットアップのスキルに統合し、Dependabot を足す |

## 4. 新しい構成案
`~/.pi/agent/` の形に合わせて、**リポジトリの `agent/` をそのまま(またはサブディレクトリごとに)シンボリックリンクできる**ようにする。Pi の設定の置き場所は `~/.pi/agent/`(`extensions/`、`agents/`、`skills/`、`prompts/`、`settings.json`)。

```
agent/
├── extensions/
│   └── harness/
│       ├── index.ts              拡張の入口。各モジュールを登録する
│       ├── guards/               仕組みで止めるもの(git / 削除・プロセス / インストール / 秘密情報)
│       ├── flow/                 流れとして組み込むもの(計画、PDCA、検証、PR・マージ、worktree、compact)
│       ├── models/               /models、/subagent-model
│       ├── usage/                Anthropic 費用、Go 使用率、Codex 使用率の表示
│       ├── subagent/             サブエージェント(方式は保留。暫定は別プロセス方式)
│       └── instructions/         固定の指示(日本語): 言語、任せ方、レビューの範囲
├── agents/                       scout / planner / worker / reviewer(日本語)
├── skills/nix-setup/             Nix + Biome + Dependabot + CI を 1 つにしたスキル
├── prompts/                      定型のワークフロー
└── settings.json                 既定のプロバイダとモデル、enabledModels など
docs/                              設計資料(このディレクトリ)
tests/                             ガードやゲートのテスト(node:test)
```
- `auth.json`(API キー、OAuth トークン)は**このリポジトリに入れない**(`.gitignore` に明記)。

## 5. 作業の段階(提案)
サンドボックスの方式と自律ループの設計は、調査中。それが決まるまで、コードの置き換えは始めない。

| 段階 | 内容 | 前提 |
|---|---|---|
| 0 | 設計資料をリポジトリに移し、刷新計画と README を書く(**今ここ**) | — |
| 1 | 旧コードの削除、新しい構成の骨組み、Pi 1.5.2 に更新、ガードのテストの土台 | サンドボックスの方式 |
| 2 | プロバイダ設定、`/models`、固定の指示の差し込み、最終行の付与 | — |
| 3 | `tool_call` のガード(Git、削除・プロセス、インストール、秘密情報) | ブランチ保護の設定 |
| 4 | サンドボックスの導入 | 方式の決定 |
| 5 | サブエージェント(暫定は方式 A) | 方式の決定または暫定 |
| 6 | PDCA の自律ループ、検証と PR・マージのゲート、独立レビュー、worktree | 自律ループの調査 |
| 7 | 利用状況の表示(Anthropic 費用、Go、Codex) | — |
| 8 | compact の制御、Nix セットアップのスキル | — |

## 6. ユーザーに確認したいこと
1. **`ubuntu-dotfiles` との関係。** 資料には「設定は katoline/ubuntu-dotfiles で管理する」とある。このリポジトリ(`pi-coding-agent-settings`)は、Pi の設定の正本として、dotfiles から参照・リンクする位置づけか、dotfiles に統合するか。
2. このリポジトリの既定ブランチは `agent/bootstrap-harness` になっている。刷新後の既定ブランチを `main` にするか。
3. 作業用のブランチ `redesign/v2` を作った。コミットと push を行ってよいか(まだ何もコミットしていない)。
