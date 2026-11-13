# 調査: Pi を使い込んでいる人たちの実践

- 日付: 2026-11-13
- 出典: 調査エージェントの報告。各項目に URL と種別(一次: 本人の発信、二次: 第三者の紹介、公式)を付けた。**調査エージェントの報告であり、すべてを私が再確認したわけではない。** 再確認できたのは、Armin Ronacher の `goal.ts` の実在と内容の一部(下の「確認できたもの」)
- 時期: 【旧】は Pi 0.x 時代(〜2026-08)、【新】は 1.x 時代(2026-10-01 の Pi 1.0 以降)。**1.x 時代に一次情報で確認できた事例は少ない**

## 前提
- Pi には権限システムもサンドボックスも組み込まれていない(公式)。隔離は外側で用意する前提で、公式の手順は Gondolin 拡張、素の Docker、Docker Sandboxes、OpenShell。

## 1. 作者・Earendil 周辺

### Mario Zechner(badlogic。Pi の作者)
- 出典: [Pi の紹介記事(2025-11-30、旧)](https://www.mariozechner.at/posts/2025-11-30-pi-coding-agent/)、[AI Engineer Europe 2026 の講演](https://www.ai.engineer/talks/RjfbvDXpFls-pi-coding-agent)、[Thoughts on slowing down(2026-03-25)](https://www.mariozechner.at/posts/2026-03-25-thoughts-on-slowing-the-fuck-down/)、[I've sold out(2026-04-08)](https://www.mariozechner.at/posts/2026-04-08-ive-sold-out/)(いずれも一次)
- **権限:** 本人の言葉は「full YOLO mode」。他のツールの確認ダイアログは「ほぼセキュリティの芝居」。理由は「データを読め、コードを実行でき、ネットワークに出られるエージェントは、安全にはできない」から。不安なら「Pi をコンテナの中で動かせ」。読み取り専用で使うなら `pi --tools read,grep,find,ls`。
- **ハーネス:** サブエージェント、plan mode、組み込み to-do は**作らない**方針。計画は `PLAN.md`、タスクは `TODO.md`。サブエージェントは bash から `pi --print` を呼ぶ形で、主な用途はコードレビュー。**並列のサブエージェントで機能を作るのは「アンチパターン」**と書いている。
- **自律ループ:** 「ループは、エージェントが done と言うまで回る」設計で、最大ステップ数はない。ただし 2026-03 の記事では、人間が不在のループを「ralphing the loop」と皮肉り、**自律ループに懐疑的**。タスクは「ループを閉じられる」(自己評価できる)ものに限り、**人間が最終ゲート**であるべきと述べている。
- 2026-04-08 の記事によると、Pi は Earendil 社の所有となり、リポジトリは `earendil-works/pi` に移った(コアは MIT のまま)。
- 確認できず: 本人の日常の隔離運用(コンテナ・VM を実際にどう使うか)。

### Armin Ronacher(mitsuhiko)
- 出典(一次): [Pi の記事(2026-01-31)](https://lucumr.pocoo.org/2026/1/31/pi/)、[The Coming Loop(2026-06-23)](https://lucumr.pocoo.org/2026/6/23/the-coming-loop/)、[Codemode(2026-10-06、新)](https://lucumr.pocoo.org/2026/10/6/codemode/)、[個人設定 agent-stuff](https://github.com/mitsuhiko/agent-stuff)
- **環境:** ターミナルの TUI で Pi を「ほぼ専用」で使う。
- **ハーネス(agent-stuff。npm では `mitsupi`):** 拡張(`/answer`、`/todos`、`/review`、`/control`、`/files`、`subagent.ts`(tmux 上で 1 つずつ実行)、`notify.ts` など)、スキル(`/commit`、`/github`、`/tmux`、`/web-browser` など)、プロンプト(`/discuss`: 計画のインタビュー形式)。README に「自分の環境向けに調整済み」との注意書き。
- **ループ:** `goal.ts` の `/goal` が自律継続の実装。ただし The Coming Loop では、**大事なコードにはループがうまくいかず、移植、性能の実験、セキュリティスキャン、調査のような限定的な作業に向く**と述べる。
- **サンドボックス:** 自分の運用は確認できず。10/6 の記事では、「Gondolin のようなものを使えば bash は隔離できるが、ハーネス自体は隔離されない」と書いている。

### 確認できたもの(私が実際にソースを読んだ): `mitsuhiko/agent-stuff` の `extensions/goal.ts`
- 実在する(約 32 KB)。「セッションのログに裏づけられた、長時間の目標モード」。状態の変更をすべて、セッションにカスタムエントリとして追記し、ブランチから復元する(外部のデータベースなし)。
- 状態: `active / paused / blocked / usageLimited / budgetLimited / complete`。`token_budget` は任意。
- **継続:** `agent_end` のフックと `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`。公式の推奨の境界(`agent_before_settle`、`agent_settled`)ではなく `agent_end` を使っている点は、先行事例の「古い方式」に当たる(Pi の公式ドキュメントでは、`agent_end` は最終アイドルの合図ではない)。
- **完了判定:** モデルが `update_goal(status="complete")` を呼ぶ**自己申告**。ただしシステムプロンプトに、「証拠に基づく**完了の監査**」を要求する長い指示がある(要件ごとに現在の証拠で証明する。「完了の主張は、要件ごとの精査に耐えなければならない」)。**独立した監査エージェントではなく、指示による自己監査**。
- **blocked の条件:** 「同じ阻害要因が、**3 ターン連続**で続いた場合だけ」blocked にしてよい(指示で縛る)。難しい、遅い、不確か、という理由では blocked にしてはならない。
- 停止: 完了、blocked、エラー(使用上限は `usageLimited`、それ以外は blocked)、中断、トークン予算(`budgetLimited` で新しい自動継続を積まない)、手動の pause。目標の文字数は 4,000 まで。

## 2. サンドボックスが具体的に書かれた事例(実践者)
| 事例 | 方式 | 要点 | 出典 |
|---|---|---|---|
| Diogo Moreira | Docker Sandboxes(microVM)+ 自作ランチャー `sbx-pi` | git ルートを検出し、プロジェクトごとにサンドボックスを作成・再利用。Pi の設定は `PI_CODING_AGENT_DIR` で共有。AGENTS.md に「passwordless sudo あり、Docker 可、秘密情報は慎重に」。ネットワークポリシーと自律ループの記載なし | [一次、2026-05-08](https://diogomr.com/posts/docker-sandboxes-pi/) |
| Ajeet Raina | Docker Sandboxes の Pi kit | `sbx secret set -g anthropic` の後、`sbx run --kit ... pi`。**キーはホスト側に置き、サンドボックス内はプレースホルダだけ(ホストのプロキシが置き換える)。** ネットワークは `sbx policy` で許可・確認 | [二次の手順、2026-05-31](https://www.ajeetraina.com/getting-started-with-the-pi-agent-kit-on-docker-sandboxes/) |
| Thomas Peklak | `ags`(rootless Podman) | `ags --agent pi`。`--lockdown` で信頼できないリポジトリを分離(秘密、SSH agent、設定のマウント、ホストのブリッジを無効にし、使い捨ての home を使って終了時に破棄)。秘密は `[[secret]]` で環境変数・シークレットストア・コマンドから指定 | [一次(README)](https://github.com/thomaspeklak/agent-sandbox) |
| Cloudflare Sandbox | Pi を 1 回の非対話実行(`pi --mode json --no-session`)で実行 | 通信を AI Gateway と github.com だけに制限。キーはプレースホルダを外向きで置換。**成否判定は終了コードではなく、`agent_settled` のイベントと最後のメッセージの `stopReason`** | [公式](https://developers.cloudflare.com/sandbox/coding-agents/pi/) |
| DEV「bubblewrap でも秘密が読めた」 | bubblewrap | Pi 1.4.0 + DeepSeek を、使い捨て VM で検証。**書き込みは遮断できたが、読み取りとネットワークは遮断できず**、`$HOME` で起動すると `.bashrc` が書き込み可能になり、**脱出経路**になった。結論は「エージェント全体ではなく、コマンド単位で隔離すべき」 | [一次](https://dev.to/chkrishnatej/i-sandboxed-my-ai-coding-agent-with-bubblewrap-it-still-read-my-secrets-3kod) |
| Palaimon | Dev Container | 「supervised autonomy(監督つきの自律)が unsupervised に勝つ」と主張し、**無人運転に反対**。例示で、自社の本番設定とは明言されていない | [一次、2026-03-19](https://blog.palaimon.io/posts/coding-agents-sandboxing-best-practices/) |
| Flavio Copes | コンテナ(見知らぬリポジトリ用) | `git push` を止める `no-push.ts` を自作。長時間の無人運転は「本物のサンドボックスがあるエージェントのほうがよい」 | [二次寄り、2026-10-02 更新](https://flaviocopes.com/pi/) |
| HN の匿名コメント | Incus VM、microvm.nix など | 「VM に個人データがないので、外向きのファイアウォールなしでも許容」など。一言のコメント | [二次](https://news.ycombinator.com/item?id=49239751) |

OpenClaw(Peter Steinberger)は Pi の SDK を組み込んだ過去の構成があるが、**現行の公式ドキュメントは OpenClaw 独自のランタイム**。Steinberger 本人の Pi 利用は確認できなかった。

## 3. ハーネスの作り込み・ループの事例
| 事例 | 要点 | 出典 |
|---|---|---|
| Jamie(jamie.codes) | pi-plan-mode(読み取り専用の計画 → 承認)→ worktree の作成 → researcher / coder / reviewer を並列に実行 → レビューしてマージ。**OS の隔離はなく**、plan mode と worktree による安全性 | [一次、2026-04-04、旧](https://jamie.codes/posts/my-pi-extension-workflow/) |
| HazAT/pi-config | `~/.pi/agent` にクローンして導入。`/plan` → `/todos` → `/execute` → `/review`。execute は worker を順次、1 コミットずつ。review が NEEDS CHANGES なら、修復 worker を**最大 2 ラウンド**。「ディスパッチやアイドル状態は完了の証明にならない」。サンドボックスの記載なし | [README](https://github.com/HazAT/pi-config) |
| DeepakNess | サンドボックスなし。`APPEND_SYSTEM.md` で「危険な編集や破壊的コマンドは、実行前に説明せよ」と指示。pi-codex-goal で DeepSeek V4 Flash が 28.5 万 URL を約 1.5 時間・約 1 ドルで収集 | [一次、2026-05-29](https://deepakness.com/blog/pi-agent-setup/) |
| samfoy/pi-ralph | 役割ごとの多段ループ。`completion_promise` と、反復・実行時間の上限。**非推奨(メンテ終了)**で、Pi 同梱の subagent 例を推奨 | [README](https://github.com/samfoy/pi-ralph) |
| tmustier/pi-ralph-wiggum | 同一セッションの反復。最大 50 回(既定)、Esc | [README](https://github.com/tmustier/pi-extensions) |

## この調査から読み取れること
1. **著名な実践者(Mario、Armin)は、自律ループに懐疑的。** 「ループを閉じられる(自己評価できる)限定的な作業」に使い、「人間が最終ゲート」。ユーザーの設計は、**検証コマンド、独立レビュー、3 周で打ち切り、完了報告の根拠の義務づけ**で、ループを閉じる仕組みを入れている点で、この考え方に沿う。一方、**CI が通ったら人間の確認なしで main に自動マージする**点は、「人間が最終ゲート」と緊張関係にある(ブランチ保護と CI が実質のゲートになる)。これは、設計の判断としてユーザーに確認したい。
2. **Mario の立場は「YOLO + コンテナ」。** 確認ダイアログではなく、外側の隔離で守る。ユーザーの方針(サンドボックスで、境界の内側は確認なし)と同じ。
3. **「サンドボックスの内側で自律ループを回し、外側の限定されたツールで push する」を完成形として実践した公開事例は、見つからなかった。** 近い設計は、`JWackerbauer/pi-sandbox`(worktree 上で commit し、人間がレビューしてマージ)と Cogbox(エージェントは commit まで、拡張が push。ただし push はサンドボックスの内側)。
4. **「秘密を中に入れない」が、実践者の共通の知恵。** ホスト側のプロキシが、外向きの通信でキーを置き換える(Docker Sandboxes、Gondolin、Cloudflare)。
5. **無人実行の成否は、終了コードではなく `agent_settled` のイベントと `stopReason` で判定する**(Cloudflare)。ループの完了判定の設計にそのまま使える。
6. **bubblewrap で「エージェント全体」を包むと、読み取りとネットワークが開いたままになり、脱出経路ができやすい**(DEV の検証)。「コマンド単位」で包み、読み取りも閉じる設定(`erichll` の厳格な構成など)が要る。

## 確認できなかった点
- Mario、Armin、Steinberger、Earendil のメンバーの、日常の隔離運用
- YouTube 動画の内容、Jay Shah の記事(404)
- Pi 1.x 時代(2026-10 以降)の一次情報は少なく、他の事例のコマンド名やパッケージ名が現行と一致するかは未検証
