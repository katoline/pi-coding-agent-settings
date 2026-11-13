# 006: 防御の前提と利用状況の表示方針

- 日付: 2026-11-13
- 状態: 決定(サンドボックスの方式は未決)

## 背景
ユーザー資料(source/pi-harness-requirements.md)を Pi の公式ドキュメントと照合した(feasibility-assessment.md)。その結果を受けて、ユーザーが次のとおり決めた。

## 決定
1. **GitHub のブランチ保護を前提にする。** 初めて GitHub に push する(コミットする)ときに、必ずブランチ保護も設定する。main への直接 push と、CI 未通過のマージは、サーバー側でも止める。`tool_call` のガードはその上に重ねる
2. **利用状況の表示**
   - Anthropic API: 残りクレジットは取得できないため、**そのセッションで使った額**を表示する(Pi 標準のフッターと `/session` の費用。サブエージェントの費用は合算する)
   - Codex: 5 時間・週間の使用率を、サードパーティ製の拡張で表示する
   - OpenCode Go: 5 時間・週間・月間の使用率を、既存の拡張で表示する
   - **非公式のエンドポイントに依存してよい**(Go の `zen/go/v1/usage`、Codex の `wham/usage`)。壊れたときは表示がエラーになるだけで、作業は止めない
3. **MacBook 側(#114)の仕組みは不要。** 資料の「作業状況の見える化」から、その使い回しの記述を外す
4. **作業を止めないために、サンドボックスの導入を進める。** 方式は未決(sandbox-options.md)

## 理由と確認した事実
- Anthropic の残高を取得する公式 API は見つからなかった。Pi の標準表示で、セッションの費用は確認できる
- Codex の使用率は、`https://chatgpt.com/backend-api/wham/usage`(未文書化)を Pi の OAuth トークンで呼ぶ拡張が複数ある。@llblab/pi-codex-usage 0.13.4(2026-11-08、Pi 1.0 以上)、pi-codex-status、pi-chatgpt-limit など
- **Codex 使用率の注意:** Pi 1.x の新しい「ChatGPT でサインイン」(`/login openai`)のトークンは `wham/usage` に拒否される。使用率を出したい場合は、従来の `/login openai-codex` でログインするか、Codex CLI にログインしておく(@llblab/pi-codex-usage の説明)
- Go の使用率は、pi-opencode-go-usage が `GET https://opencode.ai/zen/go/v1/usage` を API キーで呼んでいる。認証なしで呼ぶと 401 が返り、エンドポイントの存在は確認できた

## 却下した案
- Anthropic の残りクレジットを Console と同じ値で表示する: 取得手段がない

## 未解決事項
- どの拡張を採用するか(導入前にソースを読む)
- サンドボックスの方式(sandbox-options.md)
