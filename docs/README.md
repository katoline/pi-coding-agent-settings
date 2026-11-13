# Pi ハーネス設計(設計資料)

開始日: 2026-11-13

## このセッションの目的
Pi coding agent を使ったハーネス設計について、対話しながら検討する。**このディレクトリは、リポジトリ katoline/pi-coding-agent-settings の `docs/`(正本)。** リポジトリ全体の刷新計画は repo-redesign-plan.md。

## 記録ルール
- 決まったことは `decisions/NNN-<topic>.md` に 1 件 1 ファイルで保存する
- 各ファイルは「背景 / 決定 / 理由 / 却下した案 / 未解決事項」の形式
- 下の決定一覧に 1 行ずつ追記する
- 未決事項は `open-questions.md` で管理する

## 資料
- [research/](research/): 先行事例の調査(自律ループ、実践者、サンドボックス、公開されているハーネス)
- [repo-redesign-plan.md](repo-redesign-plan.md): このリポジトリの刷新計画(旧設計との差、引き継ぐもの・捨てるもの、新しい構成案、作業の段階)
- [source/pi-harness-requirements.md](source/pi-harness-requirements.md): ユーザーが作成した要件資料(原文)
- [feasibility-assessment.md](feasibility-assessment.md): 資料と Pi 公式ドキュメントを突き合わせた実現可能性の評価
- [subagent-design.md](subagent-design.md): 公式サンプルのサブエージェントの仕組み、方式の比較、改造プラン
- [sandbox-options.md](sandbox-options.md): サンドボックスの選択肢(Claude Code・Codex との比較、Pi 向け OSS、Ubuntu での注意)
- [install-npm-global.md](install-npm-global.md): npm グローバルで Pi を導入する際の懸念点の一覧

## 決定一覧
- [001: ハーネスは Pi (pi.dev) を使う](decisions/001-harness-is-pi.md)
- [002: プロバイダ構成(2 系統)とハーネスは Pi のみ](decisions/002-provider-architecture.md)
- [003: Pi の使い方は「人が TUI で対話」を当面の主軸とする](decisions/003-usage-mode.md)
- [004: Pi を動かすマシンの OS は Ubuntu](decisions/004-host-os.md)
- [005: 音声入力は接続元によって使い分ける](decisions/005-voice-input.md)
- [006: 防御の前提と利用状況の表示方針](decisions/006-defense-and-usage-display.md)
- [007: Pi は npm グローバルで導入する(暫定)](decisions/007-pi-install-npm-global.md)
- [008: サンドボックスは Pi の公式のものを使う(方式は要確認)](decisions/008-sandbox-policy.md)
- [009: サブエージェントの方式は保留(方式 A を暫定の前提)](decisions/009-subagent-hold.md)
- [010: 設定リポジトリを katoline/pi-coding-agent-settings に紐付け、全面的に刷新する](decisions/010-settings-repo-redesign.md)
- [011: 旧設計をすべて削除し、新しい要件でゼロから作り直す](decisions/011-rebuild-from-scratch.md)
