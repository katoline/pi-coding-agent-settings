# 調査: Pi の自律ループ(計画を最後まで実行する仕組み)

- 日付: 2026-11-13
- 出典: 調査エージェントの報告(npm レジストリ、各パッケージの README とドキュメント、一部のソース)。Pi 本体の仕様(下の「Pi 本体の仕様」)は、公式ドキュメント(1.5.2)で確認した
- **注意:** 各パッケージは**実際には動かしていない**。人気度は、npm の週間ダウンロード数(2026-11 上旬)と GitHub のスター数(ページの表示値)。GitHub API が使えなかったため、最終更新日は npm の最新版の公開日で代用した。「確認できず」は未確認の意味
- 位置づけ: ユーザーが最も重視する「確定した計画を、すべて実行するまで止まらず自律的にループする」仕組みの先行事例の整理。設計への反映は末尾

## Pi 本体の仕様(公式ドキュメント 1.5.2 で確認)
| イベント | 性質 |
|---|---|
| `agent_end` | 1 回の実行が終わった合図。**最終のアイドルではない。** この後も、自動リトライ、自動 compaction とその再実行、キューにあるメッセージの処理が続きうる |
| `agent_before_settle` | **最後に動作を起こせる境界。** セッションにエントリを追加し、**継続を 1 回要求できる**(`continue: true`)。中断(Esc)された実行では、継続の要求は抑止される |
| `agent_settled` | 最終の境界で、**通知用**。ここで要求した作業は、すべての settled ハンドラが終わってから実行される(再入しない)。中断されたかどうかは `event.aborted` で分かる |
| `turn_end` | 1 ターンごとの境界。ここでも継続を提案できる |

- 継続を無条件に要求し続けると無限ループになる。上限と停止条件は、拡張側で持つ必要がある
- `pi.sendUserMessage()` は、実際のユーザーの発言として扱われる。`pi.sendMessage()` には `triggerTurn` と `deliverAs` がある

## 調査したパッケージ

### A. 「計画の確定 → 完走 → 独立レビュー → 差し戻し」(要望に近い)
| パッケージ | 完了判定 | 継続の方法 | 暴走防止 | 週間 DL / スター | 備考 |
|---|---|---|---|---|---|
| [pi-spiral](https://www.npmjs.com/package/pi-spiral) 0.3.0(2026-11-02) | `/ralplan`(planner → architect → critic)で計画を合意。`/ralph` は受入基準つきのストーリーを 1 つずつ実装し、verify コマンドを実行。全通過後に**別ロールの reviewer**が証拠つきで確認。却下ならそのストーリーを再オープン | TypeScript のコードが制御し、各ロールは子 `pi` セッション。フックの詳細は確認できず | ralplan 最大 5 ラウンド。ralph の `maxIterations` 既定 20、ストーリーごとに 3 回失敗で blocked、`maxReviewAttempts` 既定 3(使い切ると `exhausted` で終了し、**強制承認はしない**)。`budgetTokens` 既定は無制限。実行前から失敗していたテスト(baseline)は無視し、新規の失敗だけを止める | 約 239 / 0 | 要望の流れに最も近い。executor は git push などを拒否し、**commit は一切しない**。状態は `~/.pi/agent/spiral/ralph/<project>/<runId>/` で、`--resume` で再開。VM・コンテナ連携は確認できず。実績は薄い |
| [pi-goal-x](https://www.npmjs.com/package/pi-goal-x) 0.34.1(2026-10-27) | `/goal` でエージェントが質問しながら目的・計画・完了要件の案を作り、**ユーザーが確認**。完了は `update_goal(complete)` で申請し、**独立した auditor**(別のメモリ内セッション。read/grep/find/ls/bash)が検査。出力の末尾に `<approved/>` か `<disapproved/>`。**マーカーなし・エラー・中断は不承認**(fail closed) | `agent_settled`。aborted なら継続せず pause | `maxAutonomousRuns`(未設定は無制限)、任意の `token_budget`。同一のブロッカー 3 連続でだけ blocked を許可。**auditor 不承認の回数上限は確認できず** | 約 7,194 / 129 | auditor は読み取り専用の指示だが bash が使えるので、物理的な強制は確認できず。状態は `.pi/goals/` と追記専用の JSONL |
| [pi-goal-list-loop-audit(GLLA)](https://www.npmjs.com/package/pi-goal-list-loop-audit) 0.39.69(2026-11-10) | `/goal`(曖昧な依頼は面談で `Done when:` の契約にする)、`/list`(項目ごとに監査)、`/loop`(測定値の改善)。完了は「証拠つきの申請」を、**別の auditor が検査**。未完のタスクがあると申請は拒否される | `agent_end` のエラーでリトライを制御。主な継続フックは確認できず | `auditCap` 既定 5(連続で不承認なら pause)、`auditCapHard` 8、`stuckMaxInterventions` 5、`zombieRetryMaxAttempts` 3。プロバイダの失敗は 5 時間枠でバックオフ。`compactionTokenThreshold` 200000 | 約 1,211 / 28 | **「確定 → 完走 → 独立監査 → 上限つき差し戻し」を最も機能的に実装**。ただし commit 数が 11,000 以上で、API が頻繁に変わる可能性。Pi `>=0.84.2 <2.0.0` 対応。auditor は拡張を既定で分離して実行(`auditorAllowedExtensions: []`) |
| [@pi-unipi/long-horizon](https://www.npmjs.com/package/@pi-unipi/long-horizon) 3.0.3(2026-11-04) | worker の `update_goal(complete)` は申請にすぎず、**別モデルの verifier** が `met` / `not_met` / `impossible` / `inconclusive` を返す。証拠は目的、申請、変更ファイル、コマンド、直近 5 メッセージ | one-slot の nudge と turn arbiter | goal ターン既定 50(最大 200)、無進捗 8 ターンで pause、5 連続 `not_met` か 2 連続 `inconclusive` で pause。TODO 未完で complete を主張すると、verifier を呼ばずにリマインド(最大 2 回) | 約 622 / 72 | クラッシュ後は `pendingContinuation` を最大 2 回再送し、`recovery_exhausted` で pause |

### B. Ralph 方式(チェックリスト、外側ループ)
| パッケージ | 完了判定 | 継続の方法 | 暴走防止 | 週間 DL / スター |
|---|---|---|---|---|
| [@tmustier/pi-ralph-wiggum](https://www.npmjs.com/package/@tmustier/pi-ralph-wiggum) 0.2.5 | `.ralph/<name>.md` のチェックリスト。`<promise>COMPLETE</promise>` と、最終の検証コマンド(別の監視者が新しいシェルで再実行できること)。独立レビューなし | エージェントが `ralph_done` を呼ぶと、同一プロンプトが次のキューに入る(同一セッション) | `--max-iterations` 既定 50、`--reflect-every N`、Esc で一時停止。コスト上限なし | 約 3,205 / 499(モノレポ) |
| [@lnilluv/pi-ralph-loop](https://www.npmjs.com/package/@lnilluv/pi-ralph-loop) 2.1.2 | `RALPH.md` に `completion_promise` と `completion_gate: required`。`acceptance: true` のコマンドを、完了宣言の**後に再実行**し、`ok` 以外なら完了を拒否。毎イテレーションの前に `commands`(テスト等)を実行し、新しい出力を次のプロンプトに入れる | 各イテレーションを**子プロセス `pi --mode rpc`** で実行(外部コントローラが再投入) | `max_iterations`(1〜50)、イテレーションごとの `timeout`(最大 3600 秒)、`stop_on_error`、無進捗で `no-progress-exhaustion` | 約 426 / 14 |
| [@kimuson/pi-ralph](https://www.npmjs.com/package/@kimuson/pi-ralph) 0.0.7 | 静的チェック → AI レビュー / 受入基準 → draft PR → CI・コメントの追従 → 任意でマージ | `set-ralph-loop` を 1 回呼ぶと、チェックの失敗がタスクを開いたままにする | 明示的な最大回数は確認できず | 1 スター。0.0.x で未成熟 |

lnilluv の安全策: `guardrails.block_commands`、`protected_files`、`shell_policy`(許可リスト)をコマンド単位で強制。毎回フレッシュなコンテキストで、`RALPH_PROGRESS.md` に進捗の記憶を持つ。

### C. Goal 型(Codex / Claude Code の `/goal` 相当)
| パッケージ | 特徴 | 週間 DL |
|---|---|---|
| [@narumitw/pi-goal](https://www.npmjs.com/package/@narumitw/pi-goal) 0.55.2(2026-11-13) | **最もダウンロードが多い。** 完了は `goal_complete`(証拠必須)、`goal_blocked`、`goal_wait`。**独立レビュアーはなく**、自己申告 + 証拠の形式チェック。**`agent_settled` の境界から、キュー・リトライ・compaction が終わった後にちょうど 1 回**継続。`automaticTurns` 既定 25、`noProgressTurns` 既定 3、任意のトークン予算。使用上限エラーでは既定で停止 | 約 10,500 |
| [pi-codex-goal](https://www.npmjs.com/package/pi-codex-goal) 0.7.9 | `/create-goal` で目的を完了チェックつきに膨らませる。独立レビューなし。`token_budget`(最小 50 万) | 約 1,193 |
| [@amaster.ai/pi-goal](https://www.npmjs.com/package/@amaster.ai/pi-goal) 0.1.38 | `agent_end` で小さな評価モデルが met / not yet / impossible を判定し、`sendUserMessage` で継続を促す。`agent_end` はリトライ前に発火しうるため、公式の `agent_settled` 方式より古い設計 | 約 1,566 |

### D. TODO 駆動・専用ループ・周辺
| パッケージ | 要点 |
|---|---|
| [@dumbmice/pi-todo-loop](https://www.npmjs.com/package/@dumbmice/pi-todo-loop) 0.3.2(**Pi 1.5.2 でテスト済み**) | TODO リストが空になれば終了。`turn_end` で非表示の継続メッセージ(1 行の nudge)。README 自身が「タスクを削除して空にしても満たせる」と限界を述べ、警告機構もある。**キルスイッチ: `touch ~/.pi/agent/todo-loop-off`** |
| [@computesdk/pi-loops](https://www.npmjs.com/package/@computesdk/pi-loops) | 実質はヒルクライミング。1 ラウンドで 3 つの試行を別の git worktree に fork し、**読み取り専用の judge** が再計測と不正検知をして勝者を選ぶ。`protect`(判定前に元へ復元するファイル)。独立した判定者と保護ファイルの考え方は移植価値が高い |
| [@naees/pi-loops](https://www.npmjs.com/package/@naees/pi-loops) | 「loop engineering」を自称。宣言した verifier コマンドの成功を観測しないと完了にならない。既定の上限は 3 時間と 15 サイクル。スケジュール実行では隔離 worktree に書き、レビュー用ブランチに残して**自動マージしない** |
| [pi-until-done](https://www.npmjs.com/package/pi-until-done) 0.3.1(Pi 0.81.1 向け。古い) | 契約と依存つきの計画を `approve` で確定 → ANALYSIS → RED → GREEN → REFACTOR → VERIFY → DONE。継続は `agent_settled` のみ。完了は必ず LLM judge が判定。`session_compact` の後に re-anchor を再注入 |
| [pi-atlas](https://www.npmjs.com/package/pi-atlas) 0.2.0 | `agent_settled` の guard が優先順(abort → pause、バックグラウンド待ち → 待機、ゴール有効 → 継続 + 完了監査)。無人運用では `ask_user` を 60 秒で打ち切ってデッドロックを防ぐ |
| [pi-dev-flow](https://www.npmjs.com/package/pi-dev-flow) 0.91.1 | **計画を承認するまで実装できない。各ゲートはハーネスが判定**。ツールのガードが main への commit / push を禁じ、**状態ファイルはエージェントが書けない**。worktree 分離。半自動型(各段階でユーザーの応答を要求) |
| [pi-orchestrator-config](https://www.npmjs.com/package/pi-orchestrator-config) 4.31.1 | レビュアー 5 + テストランナー 1 を並列に回し、全員承認かつテスト通過まで commit をブロック。`review_loop_max_cycles` 既定 3(**使い切ると commit を許可する**) |
| [dev-loops](https://www.npmjs.com/package/dev-loops) 1.0.11 | issue → マージ済み PR を 7 フェーズで自動化。決定論的ゲート + judge。隔離 worktree と Docker イメージがある |
| [pi-continuity](https://www.npmjs.com/package/pi-continuity) 0.5.0(Pi 1.5.2 で検証済み) | 計画の完走ではなく、出力上限やプロバイダのストリーム失敗で止まった 1 ターンの**回復層**。`agent_before_settle` の `continue: true` と `context_edit` を使う。長い自律ループの下に置く補助として有用 |
| [pi-review-loop](https://www.npmjs.com/package/pi-review-loop) | 「問題なし」が出るまで自己レビュー。Fresh Context モード(過去のレビューの周回をコンテキストから除去) |

## 設計パターンの整理
| 軸 | パターン | 代表例 |
|---|---|---|
| 継続の駆動 | ① `agent_settled` で 1 回だけ継続(最新・安全) | narumitw/pi-goal、pi-until-done、pi-atlas、pi-goal-x |
| | ② `turn_end` / `agent_before_settle` の `continue` | pi-todo-loop、pi-continuity |
| | ③ `agent_end` + `sendUserMessage` | amaster pi-goal(古い) |
| | ④ ツール呼び出し(`ralph_done`)でプロンプトを再キュー | tmustier |
| | ⑤ 外側のコントローラが子 `pi --mode rpc` / 子セッションを起動 | lnilluv、pi-spiral |
| 完了判定 | 自己申告 + 形式チェック | narumitw、pi-codex-goal、tmustier |
| | 決定論的なコマンド(acceptance、verify) | lnilluv、pi-spiral、pi-loops、dev-loops |
| | 別モデル・別セッションの独立監査 | pi-goal-x、GLLA、unipi、pi-until-done、pi-spiral |
| コンテキスト | 同一セッション + compaction + ファイルの進捗 | tmustier、narumitw、GLLA |
| | 毎イテレーションを新しいセッション | lnilluv、pi-spiral |
| 差し戻しの上限 | 明示するのは少数 | GLLA(5)、pi-spiral(3)、unipi(5 連続)、orchestrator-config(3) |
| 安全策 | 隔離 worktree、commit / push / merge の禁止が主流 | pi-spiral、naees、dev-loops、dev-flow |

**共通点**
- 状態をファイル(または Pi のセッションのエントリ)に出して、中断後に再開できる。
- 「完了」を、エージェント自身の発話だけで確定させない方向に進んでいる。
- 暴走防止は、回数・時間・トークンの上限と、無進捗の検知の組み合わせ。

**違い**
- 計画の段階で人間の確認があるか(GLLA、pi-goal-x、pi-until-done、pi-dev-flow は、確定後に自走する)。
- 独立レビューを機械的に強制するか(GLLA、pi-spiral、pi-goal-x は強制。narumitw と tmustier は強制しない)。
- 差し戻し回数の上限があるか(pi-goal-x は確認できず)。

## サンドボックスとの組み合わせ(重要な発見)
- **調査したループ系のパッケージは、どれも VM やコンテナを同梱していない。** 承認なしで動かす安全策は、別の層として重ねる前提になっている。
- ループ側のガード(pi-spiral の push 禁止、lnilluv の `shell_policy`、dev-flow のツールガード)は便利だが、**VM の境界ではない**。dev-flow などの README が「workflow guard であって security sandbox ではない」と明記している。
- 重ねる候補として報告されたもの: `pi-sandbox`(carderne、OS レベルの bash サンドボックス + ファイル系ツールの許可・拒否リスト。**拒否時はプロンプトが出るため、無人運用では、事前に許可を網羅する必要がある**)、Gondolin(Pi 連携の例が README にあるが、使い方の詳細は確認できず)、`pi-better-harness`(書き込みサンドボックス、サブエージェント、goal を同梱)。
- したがって、**「サンドボックス + 自律ループ」を一体で設計している先行事例は見つからなかった。** 我々は、この 2 つを自分で組み合わせることになる。

## Pi 以外から移植できる考え方
- **Claude Code の `/goal`**([公式ドキュメント](https://code.claude.com/docs/en/goal)): プロンプト型の Stop フックのラッパー。各ターンの後に、小型モデルが met / not met / impossible を返す。評価者は会話に出た内容だけで判定する。ツールを使わない状態が数ターン続けば停止。通常のエラーは 3 回自動でリトライしてから pause。条件に「or stop after 20 turns」のように上限を埋め込める。条件は「測定可能な 1 つの終了状態 + 確認方法 + 制約」が良い。バックグラウンド作業中は評価を保留する。Pi では、評価者に読み取りツールを持たせる実装(pi-goal-x の auditor)が上位互換になる。
- **Codex の `/goal`**(第三者の記事のみ。公式は未確認): スレッドごとに永続化。予算に達すると `budget_limited` になり、まとめの指示を 1 回出す。
- OpenCode、元祖の Ralph(Geoffrey Huntley)は、確認できず。

## 信頼性の高い事例(調査エージェントの評価。動かして検証はしていない)
1. **GLLA**: 確認制の計画、独立した auditor、不承認回数の上限、復旧と compaction の設計が、最も詳しく文書化されている。弱点は、変動の速さと小規模さ(28 スター)。
2. **pi-goal-x**: ゴールの確定 → 自走 → 独立 auditor。弱点は、不承認回数の上限が確認できないこと。
3. **pi-spiral**: 要望の流れに最も近い。弱点は、実績が薄い(スター 0、週間 DL 約 239)ことと、サンドボックスがないこと。
4. **@lnilluv/pi-ralph-loop**: フレッシュなコンテキスト、acceptance の再実行ゲート、`shell_policy` とタイムアウト。弱点は、独立した LLM レビュアーがないこと。
5. **@narumitw/pi-goal**: ダウンロードが最多で、`agent_settled` による継続、無進捗の検知、予算の扱いが堅い。弱点は、独立レビューがなく、完了が「証拠つきの自己申告」であること。

---

# 我々の設計への反映(草案。ユーザーと相談して決める)

ユーザーの要件(`docs/source/pi-harness-requirements.md`)の「自律実行」「PDCA のループ」「検証」「独立レビュー」を、上の先行事例と照らした草案。

## 方針の草案: 薄い自前のループを作り、先行事例の部品を借りる
既存のパッケージを丸ごと入れるのではなく、**数百行規模の自前のループ**を、我々のハーネスの一部として作る案。理由は次のとおり。
- 我々の要件には、既存のパッケージにない条件がある。「**3 周で収まらない項目は、止まらずに未完了として残し、他の項目を進め、最後に報告する**」(既存は、上限に達したら pause・終了が多い)、「完了報告の固定形式(要件ごとの完了・未完了、根拠)」、「PR・マージのゲートとの連動」、「日本語」、「サンドボックスとの組み合わせ」。
- 既存のパッケージは、全権限で動く。導入前のソース確認と版の固定が必要で、更新が速い(特に GLLA)。
- ただし、**先行事例の設計は、積極的に借りる**。導入する前に、GLLA、pi-goal-x、pi-spiral のソースを読んで、部品を確認する。

## 仕組みの草案
1. **状態の置き場所:** 計画(チェックリスト)を、プロジェクトの外の状態ファイル(例: `~/.pi/agent/harness/runs/<project>/<runId>/plan.json`)に置く。エージェントが直接書けないようにし(pi-dev-flow と同じ考え方)、**専用のツール**(`plan_update` など)でだけ更新させる。`pi.appendEntry()` にも写して、セッションの履歴と一致させる。
2. **継続:** `agent_before_settle` で、未完了の項目があり、停止条件に当たっていなければ、非表示の `custom_message`(「次の項目: …」)を追加して `continue: true` を返す(公式の推奨の境界。`agent_settled` は通知用)。中断(Esc)では継続しない。キルスイッチ(ファイル)を置く(pi-todo-loop)。
3. **完了判定は、エージェントの申告だけで決めない:**
   - 項目ごとに、**決定論的な検証コマンド**(ユーザーの資料の「検証コマンド」)を、ハーネスが実行する。
   - 挙動に関わる変更は、**独立レビュー**(新しいコンテキストの読み取り専用のサブエージェント。差分と要件だけを渡す)。末尾に `<approved/>` / `<disapproved/>` のようなマーカーを要求し、**マーカーなし・エラー・中断は不承認**にする(pi-goal-x)。
   - 「実行前から失敗していたテスト(baseline)は、新規の失敗と区別する」(pi-spiral)。資料の「自分の変更と関係ない既存の失敗は報告だけ」と一致する。
   - 検証を弱める行為(テストの skip、lint の無効化など)の検出(資料の「検証」)。`protect`(判定前に元へ戻すファイル)の考え方(pi-loops)を使える。
4. **停止条件と上限:** 項目ごとに 3 周(資料の仕様)で未完了にして次へ進む。全体には、ターン数、時間、トークン(または費用)の上限、無進捗の検知(同じ状態が N 回続く)、差し戻しの上限(GLLA の 5、pi-spiral の 3 を参考)。
5. **完走:** 未完了が残っていても、すべての項目を試し終えたら終了し、**固定形式の完了報告**(要件ごとの完了・未完了の理由、検証・レビューの結果、PR)を出す。最終行は「🚀作業が完了しました!」。
6. **compaction と再開:** 計画は外部ファイルにあるので、compaction の後に、チェックリストを再注入する(pi-until-done の re-anchor)。`/resume` で、中断した計画を再開できる。
7. **プロバイダの失敗:** 使用上限・ストリームの失敗は、止めずに待って再開する(GLLA のバックオフ、pi-continuity)。これは、Go の 5 時間枠や Codex の上限に当たったときに重要。
8. **サンドボックスの内側で動かす:** ループは、サンドボックス(Gondolin など)の内側で動かす。ループのガードは、VM の境界の代わりにならない。Git の書き込みとマージは、サンドボックスの外の専用ツールで、メインセッションだけに許可する。

## 決めてほしいこと
1. **薄い自前のループ + 先行事例の部品を借りる**方針でよいか。それとも、GLLA か pi-spiral を試験導入して比較するか。
2. 先行事例のソースを読む対象(GLLA、pi-goal-x、pi-spiral)の順序。
3. 計画の状態ファイルを、プロジェクトの外に置いてよいか(エージェントが書き換えられない場所)。
