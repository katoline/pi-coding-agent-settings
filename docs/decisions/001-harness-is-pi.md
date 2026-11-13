# 001: ハーネスは Pi (pi.dev) を使う

- 日付: 2026-11-13
- 状態: 決定

## 背景
ユーザーが「PyCodingAgent」と呼んでいたものは、https://pi.dev/ の Pi(パッケージ名 `@earendil-works/pi-coding-agent`)だった。Python 製ではない。

## 決定
- ハーネスには Pi を使う
- メインのモデル・プロバイダは OpenCode Go サブスクを使う
- Claude(Fable / Sonnet / Opus)は Anthropic API 経由で使う想定(要確認)
- 現在 OpenCode で行っているプロバイダ連携のやり方を、Pi でも踏襲する

## 確認できた事実(pi.dev の記述)
- UI は TUI(GUI の記載なし)
- Node/TypeScript 製と思われる。npm / pnpm / bun または curl スクリプトで導入
- モードは 4 種類: 対話(TUI)、print/JSON(`pi -p` / `--mode json`)、RPC(stdin/stdout の JSON)、SDK
- プロバイダは Anthropic、OpenAI、Google、OpenRouter、Ollama など多数。独自プロバイダは `models.json` か拡張で追加できる
- 拡張: extensions、skills、prompt templates、themes
- OpenCode の公式ドキュメントでは、Go を設定できるクライアントとして Pi が挙がっている

## 理由
ユーザーの希望(現行のプロバイダ連携を維持しつつ、ハーネスだけ Pi に替える)。

## 却下した案
なし

## 未解決事項
- Pi から OpenCode Go を使う具体的な設定手順
- Pi から Anthropic API(Claude)を使う設定、および Go との併用方法
- 4 つのモードのうち、どれを主に使うか
