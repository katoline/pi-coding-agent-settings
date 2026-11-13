# 実現可能性の評価: ユーザー資料 × Pi 公式ドキュメント

- 日付: 2026-11-13
- 対象資料: `source/pi-harness-requirements.md`
- 照合した Pi: 最初は 0.81.1 の公式ドキュメントで評価した。**その後、npm の最新版が 1.5.2 だと分かり、主要な API(`tool_call`、`before_agent_start`、`message_end`、`session_before_compact`、`agent_settled`、コマンド、UI)と、サブエージェントのサンプルを 1.5.2 でも確認した。評価の結論は変わらない**(1.5.2 は機能が増えており、`agent_before_settle`、`context_with_system`、組み込みの MCP 対応などが追加されている)
- 注意: ドキュメントとサンプルコードの読み込みによる評価であり、実機での動作確認はしていない

## 更新履歴
- 2026-11-13(追記): 次の方針をユーザーが決めた。詳細は `decisions/006`、`decisions/007`。
  - Anthropic API は残りクレジットではなく**セッションで使った額**を表示する
  - Codex・Go の使用率は非公式エンドポイントへの依存を許容する
  - GitHub のブランチ保護を前提にする
  - MacBook 側(#114)の仕組みは不要
  - 作業を止めないためにサンドボックスを導入する(方式は未決: `sandbox-options.md`)
  - Pi は npm グローバルで導入する(暫定: `install-npm-global.md`)
- サブエージェントの詳細な調査と改造プランは `subagent-design.md`

## 凡例
| 記号 | 意味 |
|---|---|
| ◎ | Pi の標準機能・公式サンプルでそのまま実現できる |
| ○ | 実現できる。ただし自作(拡張の実装)が必要、または設計上の注意がある |
| △ | 一部だけ実現できる、または非公式・未検証の手段に依存する |
| ✗ | 公式の手段では実現できない |

## 総評
- **資料の方針(ルールはハーネスで守らせる)は、Pi の拡張機構と相性が良い。** `tool_call` でツール実行をブロックでき、`before_agent_start` でシステムプロンプトを差し込め、`message_end` で最終応答を書き換えられる。
- **ほぼ全項目が実現できる。** 当初の ✗(Anthropic の残りクレジットの取得)は、「使った額の表示」への方針変更で解消した。△ は少数で、後述の「シェルコマンドの検査」と「利用状況の表示」に集中している。
- **最大の注意点は、Pi に組み込みのサンドボックスがないこと。** `bash` ツールはシェルを丸ごと実行できるため、コマンド文字列の検査だけでは「完全に止める」ことはできない(詳細は後述。対策は `sandbox-options.md`)。資料の「決定論的に強制する」という期待は、Pi 単体では一部の項目で保証できない。

## Pi の仕組みの対応表(「何で実装するか」の案)
資料の「まだ決めていないこと」への回答。

| 実装手段 | Pi の機能 | 向いている用途 |
|---|---|---|
| 拡張(TypeScript) | `~/.pi/agent/extensions/` に置く。`/reload` でホットリロードできる | イベントのフック、コマンド、カスタムツール、UI 表示のすべて |
| ツール実行の拒否 | `pi.on("tool_call", ...)` で `{ block: true, reason }` を返す。引数の書き換えもできる | Git・削除・インストール・秘密情報の制限 |
| 結果の加工 | `pi.on("tool_result", ...)`、`message_end` で最終メッセージを置換 | 秘密情報のマスク、最終行の付与 |
| 指示の差し込み | `before_agent_start` でシステムプロンプトを変更・メッセージを注入。`APPEND_SYSTEM.md` や `--append-system-prompt` も使える | 「固定の指示」(言語、任せ方、レビュー範囲) |
| コマンド | `pi.registerCommand(name, ...)` | `/models`、`/subagent-model` |
| モデル切り替え | `pi.setModel(model)`、`ctx.modelRegistry` | `/models` の実装 |
| 画面表示 | `ctx.ui.setStatus` / `setWidget` / `setFooter` / `notify` / `setWorkingIndicator` | 利用状況、サブエージェント実行中の表示 |
| 要約の制御 | `session_before_compact` で要約を自前で生成して返せる | compact 時に残す項目 |
| 状態の保存 | `pi.appendEntry()`(セッションに保存) | チェックリスト、`/subagent-model` の選択 |
| スキル | `SKILL.md` とスクリプト | Nix セットアップ |
| プロンプトテンプレート | `~/.pi/agent/prompts/*.md` | 定型のワークフロー(`/implement` など) |
| 設定 | `settings.json`(`defaultProvider`、`defaultModel`、`enabledModels` など) | 既定モデル、Ctrl+P の切り替え対象 |
| 外部の仕組み | GitHub のブランチ保護、git フック | main への直接 push と CI 未通過マージの拒否(サーバー側で確実に止める) |

## 項目別の評価

### プロバイダー
| 資料の要件 | 評価 | 根拠・備考 |
|---|---|---|
| OpenCode Go を使う | ◎ | **標準プロバイダとして内蔵**(`opencode-go`、環境変数 `OPENCODE_API_KEY`)。`models.json` で自作する必要はない(decisions/002 の当初案より簡単) |
| Anthropic API を API キーで使う | ◎ | 標準プロバイダ(`ANTHROPIC_API_KEY`)。`auth.json` または環境変数で渡せる |
| Codex をメインとして使う | ◎ | `/login` で ChatGPT Plus/Pro を OAuth 連携。ドキュメントに「OpenAI が公式に推奨」とある。トークンは `~/.pi/agent/auth.json` に保存され自動更新される |
| API キーをリポジトリに置かない | ◎ | キーは環境変数か `~/.pi/agent/auth.json`。dotfiles では `auth.json` を管理対象から外すこと |
| 「Claude Code のサブスクは Pi で使えない」 | △ | 資料の記述は正確ではない。Pi は `/login` で Claude Pro/Max にも対応するが、**第三者ハーネスの利用は「追加利用分(extra usage)」として従量課金され、プランの上限には含まれない**。API キーを使う判断自体は妥当 |
| Anthropic の上限設定を Console で行う | ◎ | Pi の範囲外(Console の機能) |

### 利用状況の表示
| 資料の要件 | 評価 | 根拠・備考 |
|---|---|---|
| OpenCode Go の 5 時間・週間・月間の使用率 | ○ | 既存の Pi パッケージ [pi-opencode-go-usage](https://pi.dev/packages/pi-opencode-go-usage) が、`GET https://opencode.ai/zen/go/v1/usage` を API キーで呼んで、ステータスバーに「Go 5h 62% · wk 31% · mo 44%」と表示している。**この URL は公式ドキュメントでは確認できなかった**が、認証なしで呼ぶと 401 を返したので、エンドポイントは存在する。仕様変更のリスクはある |
| Codex の 5 時間・週間の使用率 | ○ | 非公式のエンドポイント `https://chatgpt.com/backend-api/wham/usage`(未文書化)を、Pi が保存した OAuth トークンで呼ぶ既存パッケージが複数ある([@llblab/pi-codex-usage](https://pi.dev/packages/@llblab/pi-codex-usage) 0.13.4(2026-11-08、Pi 1.0 以上)、[pi-codex-status](https://cdn.jsdelivr.net/gh/lhl/pi-codex-status@main/README.md)、[pi-chatgpt-limit](https://cdn.jsdelivr.net/gh/patlux/pi-chatgpt-limit@main/README.md) など)。**注意: Pi 1.x の新しい「ChatGPT でサインイン」(`/login openai`)のトークンは `wham/usage` に拒否される。使用率を出すには、従来の `/login openai-codex` でログインするか、Codex CLI にログインしておく**(pi-codex-usage の説明)。使用率(%)とリセット時刻が取れる。ユーザーは非公式への依存を許容済み |
| Anthropic API の使用額 | ◎(方針変更後) | ユーザーの方針で、残りクレジットではなく**セッションで使った額**を表示する。Pi の標準のフッターが、累積の使用量と費用を表示し、`/session` でも費用を確認できる(公式ドキュメント)。**サブエージェントの費用は親に含まれない**ので、子の費用を合算する(`subagent-design.md` の改造プラン 6)。なお、残高そのものを取得する公式 API は見つからなかった(Console の Billing ページにだけ表示される) |
| 表示場所 | ◎ | `ctx.ui.setStatus` でフッターに常時表示、`/usage` のようなコマンドで詳細を表示。現在のモデルのプロバイダ分だけを出す設計もできる |

### メインエージェント・モデル選択
| 資料の要件 | 評価 | 根拠・備考 |
|---|---|---|
| メインを固定せず、起動時に選ぶ | ◎ | 標準で `/model`(Ctrl+L)、Ctrl+P による切り替えがある。`settings.json` の `enabledModels` で候補を絞れる。起動時に必ず選ばせたい場合は、`session_start` で選択ダイアログを出す拡張を書く(○) |
| `/models` でプロバイダごとの一覧を出す | ○ | `registerCommand("models")` と `ctx.modelRegistry`、`pi.setModel()` で実装できる。標準の `/model` と名前が近いので、混同しない命名を検討 |
| Opus 5.5 / Sonnet 5.5 / Fable 5.2 / Haiku 5.5 が選べる | △ | Pi 内蔵のモデル一覧に含まれているかは未確認(`pi update --models` と `pi --list-models` で確認する)。無ければ `models.json` で追加できる |
| Go と Codex のモデル一覧 | ◎ | 内蔵カタログ(自動更新)から取得される |

### サブエージェント
| 資料の要件 | 評価 | 根拠・備考 |
|---|---|---|
| サブエージェント機能 | ○ | **Pi 本体には組み込まれていない。** 公式サンプルの `examples/extensions/subagent/` が土台になる。`pi --mode json -p --no-session` を別プロセスで起動し、単発・並列(最大 8 タスク、同時 4)・連鎖の 3 モードがある。コンテキストは分離される。これを改造して使う |
| 既定を DeepSeek V4.1 Flash にする | ◎ | Go のモデル一覧で `deepseek-v4.1-flash`(表示名 "DeepSeek V4.1 Flash 1017")の存在を確認した。サンプルは起動時に `--model` を渡せる |
| `/subagent-model` で切り替え | ○ | 選択を `appendEntry` で保存し、起動時の `--model` に反映する拡張を書く |
| 開始・終了の表示(⏳ / ✅) | ◎ | サンプルが実行中・完了・失敗のアイコンを描画する。文言は自作に変更する |
| 単純な作業はメインだけで行い、使うかは自動判断 | △ | 「判断」は性質上、指示(システムプロンプトとツールの説明文)に頼る部分が残り、決定論にはならない。資料も判断基準は未決。決定論に寄せるなら、対象ファイル数などのルールを設けてツール側で検査する |
| コミット・PR・マージはメインのみ許可 | ○ | サブエージェントは別プロセスなので、**起動時に環境変数(例: `PI_SUBAGENT=1`)を渡し、子プロセス側の拡張が `tool_call` でブロックする**設計にする。サンプルは環境変数を渡していないので追加実装が要る。子でも拡張は自動で読み込まれる |
| 独立レビュー(新しいコンテキスト、差分と要件のみ) | ◎ | サブエージェントは `--no-session` で独立しているため、そのまま該当する |

### Git・削除・インストール・秘密情報(「仕組みで止める」)
**共通の評価: `tool_call` で `bash` のコマンド文字列を検査してブロックする方式で実現できる(公式サンプル `permission-gate.ts`、`protected-paths.ts` と同じ仕組み)。ただし下記の限界がある。**

| 資料の要件 | 評価 | 備考 |
|---|---|---|
| 既定ブランチへの直接 commit・push を拒否 | ○ | `git commit` / `git push` を検査し、現在のブランチ(`git branch --show-current`)や `origin/HEAD` を `pi.exec` で確認してブロックする。**確実に止めるなら GitHub のブランチ保護(main への直接 push 禁止)を併用する。** サーバー側で止まるので迂回できない |
| 既定ブランチ上で作業を始めたら作業ブランチを作らせる | ○ | `session_start` / `before_agent_start` で検出し、作成を促す、または拡張が作成する |
| force push・`--no-verify`・未マージのリモートブランチ削除を拒否 | ○ | コマンド文字列の検査。force push の防止はブランチ保護でも補える |
| テスト・CI 未通過の PR / 未検証変更のマージを拒否 | ○ | `gh pr merge` を検査し、`gh pr checks` の結果と「検証済み」の状態を確認してから通す。**GitHub の必須ステータスチェックを併用するとサーバー側でも止まる** |
| 破壊的な Git 操作はユーザーの明示許可のときだけ | ○ | `ctx.ui.confirm()` で確認する。非対話モードでは既定で拒否にする(サンプルと同じ) |
| 削除は作業ルート・一時領域の内側だけ | △ | `rm` の引数を解析して許可リストと照合できる。変数・コマンド置換・`cd` 併用を拒否する要件は、文字列検査で現実的に実現できる。ただし `find -delete`、`python -c`、シェルスクリプト経由などの**間接的な削除は検査をすり抜ける** |
| `pkill` / `killall` の拒否、`kill` の形の限定 | ○ | 文字列検査 |
| `apt` / `snap` / `npm install -g` / `nix profile install` / `home-manager switch` の制限 | ○ | 文字列検査 + 確認ダイアログ |
| `sudo` の拒否 | ○ | 文字列検査 |
| プロジェクト内の依存の導入は許可 | ○ | 許可リスト(`npm install` など。`-g` なし)で通す |
| 秘密情報(`.env`、鍵、トークン)の読み取り・出力・コミットの拒否 | △ | `read` / `write` / `edit` ツールのパス検査は確実(`protected-paths.ts` が土台)。`bash` 経由(`cat .env`、`env`、`printenv`)は文字列検査で一部を止められるが、網羅はできない。`tool_result` で出力をマスクする二重の防御ができる。コミット時の漏洩は git の pre-commit フックやシークレットスキャンの併用が確実 |

**Pi には組み込みサンドボックスがない**(公式の [Security](https://pi.dev/docs/latest/security) ドキュメントに明記)。拡張も Pi と同じ権限で動く。確実に止めたい項目は、次の層を重ねるのが現実的。
1. `tool_call` フック(日常の事故を止める。資料の「自分たちだけが操作する部品は、普通の使い方で起きる事故だけを見る」という方針と一致する)
2. サーバー側(GitHub のブランチ保護、必須ステータスチェック)
3. 必要なら OS レベルの隔離(同梱サンプル `sandbox/`、コンテナ。公式の containerization ドキュメントを参照)

### 出力・表示
| 資料の要件 | 評価 | 備考 |
|---|---|---|
| 最終応答の最後の 1 行を「🚀作業が完了しました！」にする | ○ | `message_end` で、ツール呼び出しを含まない最終のアシスタントメッセージを書き換える。`agent_settled`(再試行・要約・追加メッセージがもう無い状態)で完了を判定できる。「完了」の判定(PDCA の全項目が済んだか)を何で決めるかは設計が要る |
| サブエージェントの開始・終了表示 | ◎ | 上の表のとおり |
| 作業中がひと目で分かる | ◎ | `setWorkingIndicator`、`setWidget`、`setStatus`、`titlebar-spinner.ts`(ターミナルのタイトルのスピナー) |
| 完了の通知 | ○ | `notify.ts` が OSC 777 でデスクトップ通知を出す(Ghostty、iTerm2、WezTerm 対応)。**MacBook から SSH で接続している場合**は、手元のターミナルが対応していれば届くが、tmux 経由だと通過設定が要る。「MacBook 側(#114)の仕組みを使い回す」は、その中身を見ていないため評価できない |

### 流れとして組み込むもの
| 資料の要件 | 評価 | 備考 |
|---|---|---|
| Plan で判断をすべてユーザーと確認 | ○ | 公式サンプル `plan-mode/`(`/plan`、読み取り専用で調査)と、`question.ts` / `questionnaire.ts`(選択式の質問 UI)が土台になる |
| プラン確定後は質問せず完了まで進める | △ | Plan 確定後に質問用のツールを `pi.setActiveTools()` で外せば、ツールとしての質問は止められる。ただし、モデルが応答の文章で質問することは仕組みでは止められない。指示との併用になる |
| 判断が要る場面の既定の扱い、完了報告に「自分で判断したこと」 | △ | 指示(固定の指示)の領域。報告の形式を検査する拡張は書けるが、内容の正しさは検査できない |
| 保留項目をまとめて最後に依頼 | △ | 同上。「保留リスト」をツールで管理させると、報告に必ず出せる(○) |
| PDCA のチェックリスト | ○ | `todo.ts`(ツールとコマンド、状態の保存つき)が土台。付随作業の項目を最初に自動で入れる処理を足す |
| Check・Act のループ(3 周で打ち切り) | ○ | `agent_end` / `agent_settled` で検証の状況を確認し、足りなければ `pi.sendUserMessage()` で続行させる(公式サンプル `git-merge-and-resolve.ts` が同じ手法)。回数の上限は拡張側で数える。無限ループにならない設計が必須 |
| 要件ごとの根拠(`file:line`、コマンド出力)つきの完了報告 | △ | 形式の検査は可能。根拠が妥当かどうかは仕組みでは判定できず、独立レビューに頼る |
| 検証コマンドを変更のあとに必ず実行 | ○ | `turn_end` / `agent_settled` で「変更があったのに検証が走っていない」状態を検出し、実行を要求する。無ければ「未検証」の状態を保存し、マージのゲートで参照する |
| テスト skip・期待値の書き換え・lint 無効化の禁止 | △ | `edit` / `write` の差分に `.skip`、`eslint-disable`、`biome-ignore`、設定ファイルの緩和などが含まれるかを検査できる。ヒューリスティックなので、抜けは独立レビューで補う |
| PR 本文の固定形式での自動生成 | ◎ | スクリプトまたはカスタムツールで、差分とコミットから生成して `gh pr create` / `gh pr edit` に渡す |
| CI 通過後の自動マージ、PR の細分化、最後に一覧を報告 | ○ | `gh pr merge --auto` や `gh pr checks --watch` と、PR の記録(`appendEntry`)で実現する |
| worktree の管理(`git worktree remove <絶対パス>`、`--force` なし) | ○ | コマンド検査 + 拡張側で未保存の成果物の確認。「他セッションの worktree を削除しない」は、自分が作った worktree を記録しておき、それ以外を拒否する形にする |
| compact で残す項目 | ○ | `session_before_compact` で、要約の生成を自前で行い(資料の 5 項目を要約の指示にする)、結果を返す。公式サンプル `custom-compaction.ts` が土台 |

### 固定の指示として渡すもの
| 資料の要件 | 評価 | 備考 |
|---|---|---|
| AGENTS.md に頼らず、ハーネスの中から指示を渡す | ◎ | `before_agent_start` でシステムプロンプトに追記する。または `APPEND_SYSTEM.md`。`-nc`(`--no-context-files`)で AGENTS.md / CLAUDE.md の読み込みを無効にできる。プロジェクト側に AGENTS.md が置かれていても読まれないようにしたい場合に使う |
| サブエージェントにも同じ言語指示 | ◎ | 子プロセスでも同じ拡張が読み込まれるので、環境変数で親・子を判別して、子用の指示を差し込む |
| 言語、任せ方、レビューの範囲 | ◎ | 指示の文面。サブエージェントへの指示は、役割ごとのエージェント定義(`~/.pi/agent/agents/*.md`)に分けられる |
| 指示が「守られるか」 | — | 資料の分類のとおり、指示は非決定論的。ここは仕組みでは保証できない |

### スキル(Nix セットアップ)
| 資料の要件 | 評価 | 備考 |
|---|---|---|
| 1 つのスキルで Nix 環境、Biome、Dependabot、GitHub Actions をそろえる | ◎ | Pi のスキル(`SKILL.md` とスクリプト、Agent Skills 形式)で実現できる。`~/.pi/agent/skills/` に置くか、dotfiles から配置する |

### dotfiles での管理
| 資料の要件 | 評価 | 備考 |
|---|---|---|
| 設定を katoline/ubuntu-dotfiles で管理 | ◎ | `~/.pi/agent/` 以下の `extensions/`、`skills/`、`prompts/`、`agents/`、`settings.json` をリポジトリに置き、シンボリックリンクで配置する(サンプルのインストール手順も同じ形)。**`auth.json` は除外する**。拡張を npm パッケージとして配る方法もある |

## 要確認・要判断の事項
1. **Pi 自体の導入方法と、Nix(home-manager)の関係。** 資料ではグローバル環境を home-manager で管理している。Pi を home-manager / nixpkgs 経由で入れると、nixpkgs 側の版が古くなりやすい(decisions/004 で NixOS を見送った理由と同じ問題)。OpenCode Go は新しい Pi を前提にしているため、Pi は npm など別の経路で最新版を入れるほうが安全。
2. **資料のルールとの整合。** 「`npm install -g` を許可なしで通さない」というルールがあるため、Pi 自体を npm のグローバルに入れると、このルールと衝突する。Pi 本体の更新手順を別に決める必要がある。
3. **利用状況の表示で使う非公式エンドポイント**(Go の `zen/go/v1/usage`、Codex の `wham/usage`)に依存してよいか。壊れたときは表示がエラーになるだけで、作業には影響しないようにする設計が前提。
4. **Anthropic の残りクレジット:** 推定値で妥協するか、表示を諦めて Console で見るか。
5. **MacBook 側(#114)の仕組み**の内容(通知・作業中表示)。
6. **「サブエージェントを使うかの判断基準」**(資料でも未決)。
7. **シェルコマンド検査の限界をどこまで許容するか。** ブランチ保護など、サーバー側の防御を併用するか。
8. **Anthropic の新しいモデル(Fable 5.2 など)が Pi の内蔵カタログにあるか**(`pi --list-models`)。

## 次に決めること(提案)
1. 上の 1・2(Pi の導入方法)
2. 「仕組みで止める」の防御層(`tool_call` だけか、サーバー側の防御も併用か)
3. 実装の順序。たとえば次の順にすると、効果が大きい順に動く状態を作れる。
   1. プロバイダ設定と `/models`
   2. `tool_call` による制限(Git、削除、インストール、秘密情報)
   3. 固定の指示の差し込み
   4. サブエージェント(環境変数による親子の判別つき)
   5. PDCA・検証・マージのゲート
   6. 利用状況の表示、通知
   7. compact、Nix セットアップのスキル

## 参照した情報源
- Pi 公式ドキュメント(0.81.1): https://cdn.jsdelivr.net/npm/@earendil-works/pi-coding-agent@0.81.1/docs/extensions.md ほか(providers / models / settings / compaction / security / skills)
- Pi 同梱サンプル: `examples/extensions/` の `permission-gate.ts`、`protected-paths.ts`、`subagent/`、`plan-mode/`、`todo.ts`、`custom-compaction.ts`、`notify.ts`、`git-merge-and-resolve.ts`、`sandbox/`
- OpenCode Go: https://opencode.ai/docs/go/ 、モデル一覧 https://opencode.ai/inference/go/v1/models
- pi-opencode-go-usage: https://pi.dev/packages/pi-opencode-go-usage
- Codex 使用率の拡張: https://cdn.jsdelivr.net/gh/patlux/pi-chatgpt-limit@main/README.md ほか
- Anthropic Cost Report: https://platform.claude.com/docs/en/api/admin/cost_report
