# 05 モデルと利用状況: 3 つのプロバイダを、1 つの画面で扱う

## ねらい
OpenCode Go、Anthropic API、Codex の 3 つを、**1 つの選び方**で扱い、画面の下に「いくら使ったか / どれだけ残っているか」を出す仕組みを理解します。

## 何を作ったか
| ファイル | 役割 |
|---|---|
| `models/catalog.ts`(55 行) | モデルを 3 グループに分ける純粋関数 `groupModels`。サブエージェントの既定、Anthropic のモデル ID |
| `models/register.ts`(111 行) | `/models`、`/subagent-model`、起動時の選択 |
| `usage/parse.ts`(138 行) | 利用状況の解析と表示の整形(純粋関数) |
| `usage/register.ts`(142 行) | 取得(HTTP)、フッターのステータス、`/usage` |

## 仕組み

### A. モデルの選択
- **起動時**: `session_start`(理由が `startup` / `new`)で、**メインのモデルを選ばせる**。2 段階: プロバイダ → モデル。Esc で既定のまま。再開(`resume`)やリロードでは出さない。
- **`/models`**: 同じ選択を、いつでも。`/models anthropic/claude-sonnet-5-5` のように、直接指定もできる。
- **`/subagent-model`**: サブエージェントのモデル。既定は `opencode-go/deepseek-v4.1-flash`(安いモデルに任せる)。選択は `appendEntry` で**セッションに保存**され、再開しても残る。
- 画面がない(`ctx.hasUI` が false)、またはサブエージェントでは、選択しない。

`groupModels` が、`ctx.modelRegistry.getAvailable()`(認証済みで使えるもの)を、3 つに分けます。
- OpenCode Go: `provider === "opencode-go"`
- Anthropic: **指定した 4 つの ID だけ**(Opus 5.5 / Sonnet 5.5 / Fable 5.2 / Haiku 5.5。この順)
- Codex: `openai-codex`、または、ChatGPT でサインインした `openai`(`isUsingOAuth` で判別)

### B. 利用状況(画面下のステータス `harness-usage`)
| プロバイダ | 出すもの | 取得方法 |
|---|---|---|
| Anthropic API | **このセッションの使用額**(`$0.0123`)。サブエージェントの分を含む | セッションの assistant メッセージの `usage.cost.total` を合計。子プロセスの費用は、`rt.childCost` に足す |
| OpenCode Go | 5 時間・週・月の**使用率**と、リセットまでの時間 | `GET https://opencode.ai/zen/go/v1/usage`(**非公式**) |
| Codex | 5 時間・週の使用率 | `GET https://chatgpt.com/backend-api/wham/usage`(**非公式・未文書化**) |

- 更新のタイミング: `session_start`、`model_select`、`agent_end`。取得は、5 分に 1 回まで(`REFRESH_MS`)。`/usage` は、強制的に更新。
- **取得に失敗しても、作業は止めない**。表示が「取得できません」になるだけ。
- 形が変わって読めないときは、**空を返す**(「0%」と区別するため)。`parse.ts` は、`unknown` を受け取り、型を確かめながら読む。

## なぜこう実装したか
| 選んだこと | 却下した案 | 理由 |
|---|---|---|
| **メインのモデルを、固定せず、起動時に選ぶ** | `settings.json` で固定する | 3 つのプロバイダを、**その日の残量と、作業の重さ**で選び分けたい(要件) |
| **サブエージェントの既定を、安いモデルにした** | メインと同じ | 調べ物や実装は、安いモデルで足りることが多く、**高いモデルの残量を温存**できる。変えたいときは `/subagent-model` |
| **グループ分けを純粋関数にした** | `register.ts` の中で、直接分ける | Pi なしでテストできる(`tests/models.test.ts`) |
| **Anthropic は、残高ではなく、使用額を出す** | 残高を出す | 公式に、残高を取得する API がない(従量課金)。**セッションの使用額が、取得できる範囲で、いちばん確か** |
| **使用額に、サブエージェントの分を足す** | メインだけ | サブエージェントは、別プロセスなので、メインのセッションに費用が入らない。足さないと、**過小に見える** |
| **Go・Codex は、非公式のエンドポイントを使う** | 表示しない | ユーザーが「非公式でもよい」と判断した。そのかわり、**失敗しても止めない・読めなければ空を返す**設計にした |
| **取得の頻度を、5 分に 1 回までにした** | 毎回 | 余計な通信と、**相手側の制限**を避ける |
| **`redirect: "manual"`、8 秒のタイムアウト** | 既定の挙動 | 認証ヘッダ付きのリクエストが、意図しない先に飛ぶのを避ける。遅い相手で、画面が止まるのも避ける |
| **利用状況の取得は、サブエージェントでは動かさない** | 全部のプロセスで | サブエージェントは、画面がない。余計な通信になる |

## Claude Code では
| 観点 | Claude Code | このハーネス |
|---|---|---|
| モデルの選択 | `/model` コマンド、`--model`、設定 `model`。エイリアス(`opus`、`sonnet` など)が使える(**未確認:** 細部) | `/models`(3 グループ)、起動時の選択 |
| プロバイダ | Anthropic(API、Pro / Max のサブスク)、Bedrock・Vertex など。**他社のモデルは、標準では使えない**(未確認) | Pi の複数プロバイダ。Go・Codex・Anthropic を並べて使う |
| サブエージェントのモデル | サブエージェントの frontmatter の `model`(エイリアス・ID・継承。公式ドキュメントで確認) | `/subagent-model` と、役割ごとの `agents/*.md` の `model` |
| 利用状況の表示 | `/cost`、`/usage`、**ステータスライン**(JSON を受け取るスクリプトで、好きに表示。未確認:細部) | `setStatus` で、フッターに出す。`/usage` |
| 使用量の上限 | サブスクの枠(5 時間・週)。`/usage` などで確認(未確認:細部) | Go・Codex の使用率を取得して表示 |

**違いの要点:**
- Claude Code は、**1 社のモデルに最適化**されていて、使用量の表示も組み込み。Pi は、**複数社を並べる**ので、**表示の部分は、自分で作る**必要がある。
- 公式でないエンドポイント(Go・Codex の使用率)は、**予告なく変わりうる**。**壊れても、作業を止めない**作りにしているのは、このため。

## 試してみよう
1. `tests/usage.test.ts` を読み、`parseGoUsage` に渡している**サンプルの JSON**を見る。実際のレスポンスで、同じ形か確かめる(自分のキーで、`curl -s -H "Authorization: Bearer $OPENCODE_API_KEY" https://opencode.ai/zen/go/v1/usage`。**出力にキーは含まれないが、結果を貼る前に確認する**)。
2. `/models` で、プロバイダを切り替え、画面下のステータスが変わるのを見る(Anthropic → 使用額、Go → 使用率)。
3. `/subagent-model anthropic/claude-haiku-5-5` に変えて、サブエージェントを呼び、`/usage` で、**費用が増える**のを見る。`/subagent-model reset` で戻す。
4. `harness.json` で `selectModelOnStartup` を false にして、起動時の画面が出ないことを確かめる。
5. `formatMeters` の出力を変えてみる(`5h 62% · 週 31%`)。`npm test` で、テストが何を期待しているかを見る。

## 限界と注意
- **Go・Codex の使用率は、実際のアカウントで未検証**です(パーサーは、想定した JSON でテスト済み)。形が違えば、「取得できません」と出る。
- Codex の使用率には、**従来のログイン(`/login openai-codex`)**のトークンが必要。ChatGPT でサインインした `openai` プロバイダでは、取得できない。
- Anthropic の使用額は、**このセッションだけ**。月の合計や、残高は出せない。
- 費用は、Pi がモデルの単価表から計算した値。**請求額と、ずれることがある**。
