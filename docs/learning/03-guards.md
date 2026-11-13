# 03 ガード: 危険な操作を、仕組みで止める

## ねらい
「`main` に push しない」「ホームの下を `rm -rf` しない」「秘密のファイルを読まない」を、**AI へのお願いではなく、コードで強制する**仕組みを理解します。このハーネスの中心です。

## 何を作ったか
| ファイル | 役割 |
|---|---|
| `guards/register.ts`(105 行) | Pi の `tool_call` / `tool_result` に接続する。fail-closed のラッパー |
| `guards/index.ts`(88 行) | `evaluateBash`(bash の検査)、`evaluateFileTool`(read / write / edit など)。各ガードの結果をまとめる |
| `guards/git.ts` | `git` と `gh` の検査(force push、既定ブランチへの push、履歴の破壊、サブエージェントの制限) |
| `guards/fs.ts` | 削除(`rm`、`find -delete` など)を、許可した場所の内側に限る |
| `guards/install.ts` | `sudo`、システムのパッケージ管理、`npm install -g`、保護されたパスへの書き込み |
| `guards/secrets.ts` | 秘密のファイル・変数の読み取りを止める。出力の秘匿(`redact`) |
| `guards/paths.ts` | 「この場所は、許可された範囲の内側か」の判定 |
| `lib/shell.ts`(620 行) | **シェルコマンドの解析器**。ガードの土台 |
| `lib/verdict.ts`(18 行) | 判定の型(`allow` / `ask` / `block`)と、`combine` |
| `lib/git-state.ts` | 現在のブランチ、既定ブランチ、マージ済みのリモートブランチを調べる |

## 仕組み

### 1. 判定の型: `Verdict`
```ts
type Verdict = { kind: "allow" } | { kind: "block"; reason } | { kind: "ask"; reason };
```
- `block`: 実行させない。`reason` が AI に返り、AI は別の手段を考える
- `ask`: 画面があれば、ユーザーに確認する。**画面がなければ(サブエージェントなど)拒否**
- `combine`: 複数の判定を 1 つにする。優先順位は **block > ask > allow**(1 つでも block があれば block)

### 2. bash の検査の流れ(`evaluateBash`)
```
コマンドの文字列
  → parseShell: 構文を解析(失敗したら block)
  → opaque(eval など、中身が分からない)なら block
  → invocations: 「どのコマンドを、どんな引数で呼ぶか」の一覧にする
  → 各コマンドに、各ガードを当てる(git / gh / fs / install / secrets / protected)
  → combine で、1 つの判定にする
```
**ポイントは、文字列のパターン照合(`git push` を探す)ではなく、シェルを解析すること**です。
次の書き方は、どれも `git push --force` と同じですが、単純な文字列検索では、すり抜けます。
```
git -C repo push --force            # 前置オプション
FOO=1 git push -f                   # 環境変数の前置き
sh -c 'git push -f'                 # 入れ子のシェル
echo x | xargs git push -f          # xargs 経由
git push origin "+main"             # クォート・+ 付きの refspec
cd /tmp && rm -rf ~/Documents       # cd との組み合わせ
```
`lib/shell.ts` は、クォート、`$(...)`、ヒアドキュメント、リダイレクト、`env` / `nohup` / `xargs` などの**ラッパー**、`sh -c`、`cd` のあとの相対パスを扱います。**解析できないものは、通さない**(fail-closed)。

### 3. 各ガードが、止めるもの
**git(`guards/git.ts`)**
| 操作 | 判定 |
|---|---|
| force push、`--no-verify`、`--mirror`/`--all`/`--prune` | block |
| 既定ブランチ(`main` など)への push | block(「作業ブランチを push し、PR を作る」と案内) |
| ブランチ名を変数で組み立てた push | block(判定できないため) |
| マージ済みでないリモートブランチの削除 | block |
| `commit --amend`、`reset --hard`、`clean`、`rebase`、`branch -D` など、変更や履歴を失う操作 | ask(許可制) |
| サブエージェントからの `commit` / `push` / `merge` / `rebase` など | block(変更は親に任せる) |
| `gh pr create` / `merge`、`gh api` の書き込み、`gh repo` / `release` など | block(PR とマージは、専用のツールで。[08](08-verify-review-pr.md)) |

**削除(`guards/fs.ts`)**: 許されるのは、**作業ルート**(`config.default.json` の `workRoots`)と**一時領域**の内側だけ。`xargs` 経由、`cd` と組み合わせた相対パス、変数で組み立てたパスは block(対象が実行時まで決まらないため)。

**インストール(`guards/install.ts`)**: `sudo` などの権限昇格は block。`apt`、`snap` などは block。`npm install -g` や `nix profile install` は ask(許可制)。

**秘密(`guards/secrets.ts`)**: `.env`、`*.pem`、SSH の鍵などへの read / write / `cat` などを block。ただし、`.env.example` のような雛形は通す。`env` / `printenv` で、環境変数を全部出すのも block。**出力側でも、`tool_result` で、秘密らしい文字列を `[秘匿]` に置き換える**(二重の守り)。

**保護されたパス(`guards/install.ts`)**: `~/.pi/agent`(ハーネス自身と認証情報)と、`protectedGlobalPaths`(ubuntu-dotfiles)は、cwd がその中にあるときだけ変更できる。

**ファイルツール(`evaluateFileTool`)**: write / edit は、**既定ブランチの上では禁止**(先に作業ブランチを作らせる)。`.git` の中も禁止。

### 4. fail-closed のラッパー(`register.ts`)
Pi は、`tool_call` のフックが**例外を投げると、ツールをそのまま実行します**(ゲートを通さない)。そのため、フック全体を `try / catch` で包み、**例外は、必ず `block` に変換**しています。
```ts
pi.on("tool_call", async (event, ctx) => {
  try { ...判定... }
  catch (error) { return { block: true, reason: "ハーネスのガードで内部エラー..." }; }
});
```
git の状態の取得(`git rev-parse` など)も、同じです。失敗したら、**安全側**の値(既定ブランチかもしれない、として扱う)になります。

### 5. 許可制(ask)の処理
```ts
if (ctx.hasUI) { const ok = await ctx.ui.confirm(...); ... }
else { block "対話の画面がないため、許可を得られず、実行しませんでした" }
```
画面がない(サブエージェント、無人運転)では、**ask は block と同じ**です。夜通しの無人運転で、確認待ちで止まらないように、**止めるべきものは block、許可制にするものは最小限**にしています。

## なぜこう実装したか
| 選んだこと | 却下した案 | 理由 |
|---|---|---|
| **コードで強制する** | `AGENTS.md` に「やるな」と書く | 書いても、守られるかは毎回ぶれる。長い作業の途中で、忘れることもある |
| **シェルを解析する** | 文字列・正規表現で `git push` を探す | クォート、`-C`、`sh -c` で、簡単にすり抜けられる。すり抜けは、見つけにくく、静かに起きる |
| **解析できなければ block** | 解析できないものは、通す | 「通す」と、攻撃(や、AI の偶然の書き方)が、いちばん弱い所に集まる |
| **block を、理由と代わりの手段つきにする** | 単に「禁止」と返す | AI が、迷って、別の危険な方法を試すことを防ぐ。「`main` に push は禁止 → 作業ブランチを push して、`harness_pr_create` を使う」と、**次の一手を渡す** |
| **ask を最小限にした** | 危険なものは全部 ask | 無人運転では、ask は止まる原因になる。本当に取り返しがつかないものだけ、block にし、判断が要るものだけ ask にした |
| **ガードを純粋な関数にした** | `register.ts` に、直接書く | Pi なしでテストできる(`tests/git-guard.test.ts` など)。ほかのエージェントに移すときも再利用できる |
| **`gh` の書き込みを bash では block し、専用ツールにした** | `gh pr merge` を許可する | bash は何でも書ける。ツールなら、条件(検証・レビュー済みか)を、コードで確かめてから実行できる |

## Claude Code では
| 観点 | Claude Code(公式ドキュメントで確認) | このハーネス |
|---|---|---|
| 仕組み | **権限ルール** + **`PreToolUse` フック** | `tool_call` フック 1 つに、全部 |
| ルールの書き方 | `permissions.deny: ["Bash(git push *)", "Read(./.env)"]` など、**パターンを設定に書く** | コードで、シェルを解析して判定 |
| 判定 | `allow` / `ask` / `deny`。優先順位は **deny → ask → allow** | `allow` / `ask` / `block`。優先順位は block > ask > allow(同じ考え) |
| フックでの拒否 | 終了コード `2`、または JSON の `permissionDecision: "deny"`。理由は、標準エラー出力から、Claude に返る | `{ block: true, reason }`。理由は、AI に返る |
| 確認の画面 | 権限モード(default / acceptEdits / plan / auto / bypassPermissions)で、確認の頻度が変わる | 画面があれば確認、なければ拒否。モードは、なし |
| 複合コマンド | パターン照合で、`&&` や `;` で分けた**それぞれの部分**を見る(**未確認:** 細部) | 自作の解析器で、入れ子・ラッパー・`cd` まで見る |
| 設定の範囲 | 管理者 / ユーザー / プロジェクト / ローカル(管理者の設定は、上書きできない) | `config.default.json` と、`<設定ディレクトリ>/harness.json` |
| OS での隔離 | **サンドボックス**(bubblewrap / Seatbelt)が、組み込み | **未実装**([../sandbox-options.md](../sandbox-options.md)) |

**同じ考え、違うところ:**
- 両方とも、「モデルに頼まず、ハーネスが止める」が基本。拒否の理由をモデルに返し、別の道を考えさせる点も同じ。
- Claude Code は、**設定(パターン)で書ける**ので、始めるのが簡単で、更新も追従される。ただ、パターンは「文字列の照合」が基本なので、複雑な書き方への耐性は、公式の仕様を見て判断する必要がある(未確認)。
- このハーネスは、**解析器を自作した分、細かく止められる**一方、**保守は自分の責任**。シェルの文法は広く、**解析器に穴がある可能性は、常にある**。だから、**OS のサンドボックス(最後の壁)が、本来は必要**です。
- Claude Code は、権限ルールだけでなく、**サンドボックスで、ファイルとネットワークを OS が制限**できます。ルールの穴を、OS が受け止める二重構造です。このハーネスには、まだ、2 枚目の壁がありません。

## 試してみよう
1. テストを読む: `tests/git-guard.test.ts`、`fs-guard.test.ts`、`install-guard.test.ts`、`secrets-guard.test.ts`、`shell.test.ts` を開き、**「何を通し、何を止めるか」の例**を見る。テストは、**仕様書として読める**。
2. 解析器を、手で試す(Pi は不要):
   ```bash
   node --input-type=module -e '
   import { parseShell, invocations } from "./agent/extensions/harness/lib/shell.ts";
   const p = parseShell(`FOO=1 git -C x push --force "origin" && echo $(date)`);
   console.log(JSON.stringify(invocations(p).map(i => [i.name, i.args.map(a => a.value)])));
   '
   ```
3. ガードに、**新しい禁止を足す**: `guards/git.ts` の `SUBAGENT_DENIED_GIT` や、`checkPush` に、条件を足し、`tests/` に、対応するテストを書く。`npm run check` で通るか確認する。
4. わざと、すり抜けを探す: 試用環境で、AI に「`bash -c "$CMD"` で削除して」などと頼む。止まるか確認する。止まらないものを見つけたら、**テストを足してから、直す**。
5. `ctx.hasUI` が false の場合(`pi -p "..."` の、画面なしの実行)で、`npm install -g` が、**確認されずに拒否される**ことを確かめる。

## 限界と注意
- **サンドボックスが未実装**: ガードをすり抜けた操作は、そのまま実行される。最後の壁がない。
- **解析器の穴**: たとえば、AI が、スクリプトファイルを書き、それを実行する(`write` で作り、`bash script.sh`)場合、**スクリプトの中身は、検査されません**。ファイルを作る操作は、ファイルツール側で検査されますが、実行される内容までは見ていません。サンドボックスで補う領域です。
- **read / write / edit 以外のツール**(拡張で足した、ほかのツール)は、`evaluateFileTool` の対象外です(許可)。足すときは、ここを見直す。
- ガードは、**悪意のある操作**ではなく、**AI の事故**を主に想定しています。
