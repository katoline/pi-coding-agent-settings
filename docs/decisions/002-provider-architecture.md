# 002: プロバイダ構成(2 系統)とハーネスは Pi のみ

- 日付: 2026-11-13
- 状態: 決定(設定の詳細は未検証)

## 背景
現在は OpenCode から Anthropic API を使って Claude(Fable / Sonnet / Opus)を使っている。ハーネスだけを Pi に替えたい。

## 決定
1. ハーネスは Pi のみを使う。OpenCode のハーネスは使わない
2. プロバイダは 2 系統にする
   - 系統 A: OpenCode Go サブスク(API として利用)。Pi のカスタムプロバイダ(`models.json`)として登録する
   - 系統 B: Anthropic API(Fable / Sonnet / Opus)。OpenCode とは別に、Pi に直接紐付ける

## 理由(調査で確認した事実)
- Go に含まれる Claude は Haiku 5.5 のみ。Fable / Sonnet / Opus は Go では使えない → Anthropic API は Pi に直接つなぐ必要がある
- Go は OpenCode 以外のコーディングエージェントも対象としており、検証済みクライアントに Pi が含まれる
- Go のエンドポイント
  - OpenAI 互換: https://opencode.ai/inference/go/openai/v1/chat/completions (一部モデルは .../openai/v1/responses)
  - Anthropic 互換: https://opencode.ai/inference/go/anthropic/v1/messages
  - モデル一覧: https://opencode.ai/inference/go/v1/models
- Go 側の利用条件: 専用の user agent を名乗る、会話ごとに固定のセッション ID を `x-opencode-session` ヘッダで送る。通信は監視される。古い Pi は更新が必要
- Pi 側の設定
  - Anthropic は標準プロバイダ。`ANTHROPIC_API_KEY` 環境変数か、`auth.json`(`/login`)で設定する
  - カスタムプロバイダは `~/.pi/agent/models.json` に定義し、`"api": "anthropic-messages"` などと `baseUrl`、`apiKey` を指定する
  - 認証情報の解決順: `--api-key` フラグ → `auth.json` → 環境変数 → `models.json` のキー

## 却下した案
- OpenCode に連携済みの Anthropic API を Go 経由で使う案: Go が Claude(Haiku 5.5 以外)を提供しないため不可

## 未解決事項
- 実際に入れる Pi のバージョンでの `models.json` の正確な書式
- Go のどのモデルを、どの用途に使うか
- 2 系統のモデルの使い分け(モデル切り替えの運用)
- API キーの保管方法(環境変数か auth.json か)

## 更新(2026-11-13): 3 系統へ変更、Go は標準プロバイダ
- ユーザー資料(source/pi-harness-requirements.md)により、プロバイダは 3 系統になった
  - OpenCode Go: サブエージェントの既定。メインとしても選べる
  - Anthropic API: API キーを直接読み込ませる
  - Codex: メインとして選べる(Pi の `/login` で ChatGPT Plus/Pro を連携)
- 調査の結果、OpenCode Go は Pi の標準プロバイダ(`opencode-go`、環境変数 `OPENCODE_API_KEY`)として内蔵されている。上の「`models.json` に登録する」という案は不要
- 「Claude Code のサブスクは Pi で使えない」について: Pi は Claude Pro/Max の `/login` に対応するが、第三者ハーネスの利用は追加利用分(extra usage)として従量課金され、プランの上限には含まれない。API キーを使う判断は妥当
- Go のサブエージェント既定モデル DeepSeek V4.1 Flash(ID: `deepseek-v4.1-flash`)が Go のモデル一覧にあることを確認した
