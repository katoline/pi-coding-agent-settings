# pi-coding-agent-settings

[Pi coding agent](https://pi.dev/) のハーネス(拡張・フック・コマンド・スキル・設定)を、Ubuntu PC で一から作り込み、管理するためのリポジトリです。

> **状態: 全面刷新中(設計段階)。** 旧設計(Docker ランチャー、bash 禁止、AGENTS.md による方針)は、新しい設計では使いません。旧コード(`scripts/`、`Dockerfile`、`.pi/extensions/harness.ts` など)は、刷新が進み次第、置き換えて削除します。刷新計画は [docs/repo-redesign-plan.md](docs/repo-redesign-plan.md) です。

## 基本方針
**ルールは「コンテキスト」ではなく「ハーネス」で管理します。** 作業のルールは AGENTS.md に書かず、Pi の拡張・フック・コマンド・スクリプト・設定として実装し、仕組みで守らせます。コンテキストに書いたルールは守られ方が毎回ぶれ(非決定論)、ハーネスで強制すれば毎回同じ動きになる(決定論)ためです。ルールは次の 3 種類に分けて実装します。

1. **仕組みで止める・強制するもの**(Git、削除、インストール、秘密情報など)
2. **流れとして組み込むもの**(計画 → 実行 → 検証 → 直して再確認 → PR・マージの PDCA ループ)
3. **固定の指示として渡すもの**(判断が要るもの。AGENTS.md ではなく、ハーネスの中から渡す)

## 目指す姿
- メインのモデルは固定せず、起動時に `/models` で選ぶ(OpenCode Go / Anthropic API / Codex の 3 系統)
- サブエージェントは、既定で OpenCode Go の DeepSeek V4.1 Flash。`/subagent-model` で切り替え
- **確定した計画を、すべて実行し終えるまで止まらずに進める**(自律的なループ)
- 利用状況の表示(Anthropic API はセッションの使用額、Go・Codex は使用率)
- サンドボックスで、境界の内側は確認なしで自由に作業させる
- GitHub のブランチ保護を前提に、CI が通ったら main へ自動マージ

## 設計資料
すべて [docs/](docs/README.md) にあります。

| 資料 | 内容 |
|---|---|
| [docs/source/pi-harness-requirements.md](docs/source/pi-harness-requirements.md) | 要件の原文 |
| [docs/feasibility-assessment.md](docs/feasibility-assessment.md) | 要件を Pi の公式ドキュメントと照合した実現可能性の評価 |
| [docs/decisions/](docs/decisions/) | 決定記録(1 件 1 ファイル) |
| [docs/open-questions.md](docs/open-questions.md) | 未決事項 |
| [docs/sandbox-options.md](docs/sandbox-options.md) | サンドボックスの選択肢 |
| [docs/subagent-design.md](docs/subagent-design.md) | サブエージェントの仕組みと方式の比較 |
| [docs/install-npm-global.md](docs/install-npm-global.md) | Pi を npm グローバルで導入する際の懸念点 |
| [docs/repo-redesign-plan.md](docs/repo-redesign-plan.md) | このリポジトリの刷新計画 |

## 前提
- 実行環境: Ubuntu(デスクトップ PC)。MacBook から Tailscale 経由で接続して使うこともある
- Pi: npm グローバルで導入(Node.js 22.19 以上)。版は固定して、手動で更新する
- API キーや OAuth トークン(`~/.pi/agent/auth.json` など)は、**このリポジトリに置かない**
