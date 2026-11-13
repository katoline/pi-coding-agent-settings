# 012: ハーネス v1 の実装と、暫定の選択

- 日付: 2026-11-13
- 状態: 実装済み(暫定の選択を含む)

## 実装したもの(docs/source/pi-harness-requirements.md の要件との対応)
| 要件 | 実装 | 検証 |
|---|---|---|
| ルールはハーネスで強制(AGENTS.md に書かない) | `guards/`(fail-closed の `tool_call`)、`instructions/`(`<harness>` セクション) | ユニット + 統合 |
| Git の拒否(既定ブランチ、force push、`--no-verify`、マージ済み以外の削除、破壊的操作の許可制、サブエージェントの制限) | `guards/git.ts` | ユニット + 統合(force push) |
| 削除・プロセス停止 | `guards/fs.ts`、`guards/paths.ts` | ユニット |
| パッケージ・sudo・グローバル環境 | `guards/install.ts` | ユニット |
| 秘密情報(読み取り・出力・コミット) | `guards/secrets.ts`(拒否 + 出力の秘匿) | ユニット |
| 最終行「🚀作業が完了しました！」 | `output/` | ユニット + 統合 |
| サブエージェント(表示、既定モデル、子の制限) | `subagent/` | ユニット + 統合(実際の子プロセス) |
| `/models`、`/subagent-model` | `models/` | ユニット + 統合(コマンドの登録) |
| 利用状況 | `usage/` | ユニット(パーサー) |
| Plan → Do → Check → Act、自律実行、3 周で打ち切り | `flow/plan.ts`、`flow/loop.ts`、`flow/register.ts` | ユニット + 統合 |
| 検証、独立レビュー | `flow/verify.ts`、`flow/review.ts` | ユニット |
| PR・マージ・worktree | `flow/pr.ts`、`flow/git-tools.ts` | ユニット(実際の git と bare の origin) |
| compact で残すもの | `compaction/` | ユニット |
| Nix セットアップのスキル | `agent/skills/nix-setup/` | ユニット(生成の確認) |
| 設定は dotfiles で管理(シンボリックリンク) | `scripts/install.sh` | ユニット + 統合 |

## 暫定の選択(ユーザーの決定を待たずに、既定を置いたもの)
- **サブエージェント: 別プロセス方式(方式 A)**。決定記録 009 のとおり、ユーザーは保留とし、暫定の前提とした
- **自律ループ: 薄い自前の実装**。先行事例(docs/research/autonomous-loops.md)の部品を借りた(`agent_before_settle` による継続、独立した監査者と fail-closed のマーカー、項目ごとの差し戻しの上限、キルスイッチ、無進捗の検知、`appendEntry` による保存と復元)
- **マージ方法: merge commit**(コミットを細かく残すため。squash ではない)
- **ブランチ保護のルールセット**: PR 必須、force push と削除の禁止、必須のチェック `quality`、bypass なし
- **既定の上限**: 差し戻し 3 周、継続 200 回、経過 240 分、無進捗 3 回、サブエージェント 1 回に 8 件・同時 4・合計 64
- **Anthropic のモデル ID**: Pi 1.5.2 の内蔵カタログで、`claude-opus-5-5`・`claude-sonnet-5-5`・`claude-fable-5-2`・`claude-haiku-5-5` を確認(`/models` の並び順)。OpenCode Go の `deepseek-v4.1-flash` も確認

## 未実装・未検証
- **サンドボックス(決定記録 008)は未実装。** 方式が未決(公式の Gondolin 拡張は、ゲストが Alpine で、Nix とプロジェクトの検証コマンドを動かせるかが未確認)。ガードは、サンドボックスの代わりにならない
- 実際の LLM での動作、実際の GitHub 上の操作(ルールセット、PR、マージ)、Go・Codex の使用率の実機での取得は未検証
- サブエージェントの worktree の自動作成(`harness_worktree` を、モデルが使う前提)、`harness_review` を実際の LLM で回した結果は未検証
- 音声入力(決定記録 005)は、このリポジトリの対象外(Aqua Voice と Pi 拡張は、別途導入)

## 統合テストで見つけた不具合
サブエージェントの既定モデルが、セッション開始時に、固定の既定へ上書きされていた(修正済み)。統合テストが、実際の子プロセスの接続先から見つけた。

## 未解決事項
- サンドボックスの方式と導入(docs/sandbox-options.md)
- サブエージェントの方式の確定
- ubuntu-dotfiles との関係
- 既定ブランチ名(現在は agent/bootstrap-harness)
