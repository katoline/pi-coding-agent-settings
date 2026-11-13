# 01 インストールして動かす

## ねらい
Pi とこのハーネスを入れて、**実際に動かして、ガードが効くところを見る**。理解は、動かすところから始めます。

> ⚠️ **サンドボックスは未実装です。** bash はホストでそのまま動きます。最初は、**重要なファイルのない、使い捨てのディレクトリ**で試してください。

## 手順

### 1. 前提を確認する
```bash
node -v        # v22.19.0 以上
git --version
gh --version   # PR・マージのツールを試すときに必要
```
Node は、あなたの PC に入っているものを使います。`node -v` が `v22.19.0` 未満なら、先に更新してください(Pi が要求します)。

### 2. Pi を入れる(npm グローバル)
`sudo` を使わないように、グローバルの置き場所を、ホームの下にします。
```bash
npm config get prefix                 # /usr や /usr/local なら、下の 2 行で変える
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"   # シェルの設定ファイル(~/.profile など)にも書く
```
版を**固定**して入れます(Pi は更新が速く、拡張が内部 API に依存するため)。
```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.2
pi --version
```
詳しい理由は [../install-npm-global.md](../install-npm-global.md)。

### 3. まず、**試用の設定ディレクトリ**で試す(おすすめ)
本番の `~/.pi/agent` を汚さずに試せます。環境変数 `PI_CODING_AGENT_DIR` で、Pi の設定ディレクトリを切り替えられます。
```bash
git clone https://github.com/katoline/pi-coding-agent-settings
cd pi-coding-agent-settings
export PI_CODING_AGENT_DIR=$HOME/pi-trial
scripts/install.sh --dry-run     # 何をするかを表示するだけ
scripts/install.sh               # シンボリックリンクを作る
ls -l $PI_CODING_AGENT_DIR/extensions    # harness -> このリポジトリ、になっている
```
`install.sh` は、`extensions/harness`、`agents/*.md`、`skills/nix-setup`、`settings.json` を、**リンク**で配置します。リンクなので、リポジトリのコードを編集すると、すぐ反映されます(Pi の中で `/reload`)。既存のファイルは上書きせず、競合として失敗します。

### 4. API キーを設定する
`auth.json` や環境変数に入れます。**リポジトリには、絶対に置きません。**
```bash
export ANTHROPIC_API_KEY=sk-ant-...      # Anthropic API
export OPENCODE_API_KEY=...              # OpenCode Go
```
Codex(ChatGPT のサブスク)は、Pi の中で `/login` を使います。使用率の表示も使うなら、従来のログイン `/login openai-codex` が必要です([05](05-models-and-usage.md))。

### 5. 使い捨てのディレクトリで起動する
```bash
mkdir -p ~/pi-sandbox-trial && cd ~/pi-sandbox-trial && git init -q -b main
pi
```
起動すると、**メインのモデルを選ぶ画面**が出ます(`selectModelOnStartup`。[05](05-models-and-usage.md))。

## 試してみよう(ガードが効くのを見る)

Pi の中で、次のように頼みます。毎回、**何が起きたか**を観察してください。

| 頼む内容 | 期待すること | 関係する章 |
|---|---|---|
| 「`git push --force origin main` を実行して」 | 実行されず、「force push は禁止」と、理由が AI に返る | 03 |
| 「`.env` というファイルを作って、`KEY=abc` と書いて」 | 拒否される(秘密のファイル) | 03 |
| 「`rm -rf /tmp/x` を実行して」 | 一時領域の内側なので、実行される。`rm -rf ~/Documents` は拒否される | 03 |
| 「`sudo apt install ripgrep` を実行して」 | 拒否される(sudo は実行させない) | 03 |
| 「`npm install -g typescript` を実行して」 | **確認の画面**が出る(許可制) | 03 |
| 「README.md を作って。計画を立ててから進めて」 | 計画を確認する画面が出る → 確定後は、質問せずに進む | 07 |
| `/models`、`/subagent-model`、`/usage`、`/plan` | それぞれのコマンドが動く | 05 / 07 |

`main` ブランチ上でファイルの作成を頼むと、「先に作業ブランチを作れ」と拒否されます(`git switch -c feat/x` で、作業ブランチを作ってから)。

### 動かしたあとに見るもの
- **ガードの拒否メッセージ**: `guards/git.ts` などの文字列と、同じです。メッセージは、**AI が次に何をすべきか迷わない**ように、代わりの手段を案内しています。
- **画面下のステータス**: `harness-plan`(計画の進み)、`harness-usage`(使用額・使用率)。

## 動作を確認する(テスト)
```bash
npm ci --ignore-scripts
npm run check      # biome + tsc + テスト(176 件。統合テストを含む)
```
統合テストは、**実際の Pi を起動**し、偽のモデルに台本どおりの操作をさせます([10 テストの読み方](10-tests.md))。

## つまずいたら
| 症状 | 原因と対処 |
|---|---|
| `pi: command not found` | PATH に `~/.npm-global/bin` が入っていない |
| `scripts/install.sh` が「競合」で失敗 | 同じ名前のファイルがすでにある。内容を確認し、手動で移す |
| モデルの選択画面が出ない | `harness.json` の `selectModelOnStartup` が false、または認証が未設定(使えるモデルがない) |
| 拡張を直したのに反映されない | Pi の中で `/reload` |
| 拡張が読み込まれない・コマンドが出ない | 構文エラーなどで、拡張の読み込みに失敗している。Pi の起動時のエラー表示と、`npm run check` の型エラーを確認 |
| どの操作も「ハーネスのガードで内部エラー」で拒否される | ガードの実行中に例外が起きている。**エラーのときは、安全のため拒否する設計**(fail-closed。[03](03-guards.md))。例外の内容が、メッセージに出る |

## Claude Code では
- Claude Code は、インストーラーで入れ、設定は `~/.claude`(未確認)。Pi も、拡張や設定を**ファイルで置く**のは同じ。
- Claude Code の設定には、管理者・ユーザー・プロジェクト・ローカルの 4 つの範囲と、優先順位があります(権限のドキュメントで確認)。Pi は、**`~/.pi/agent`(全体)と、プロジェクトの `.pi/`** です。プロジェクトの `.pi/` は、**信頼した場合だけ**読み込まれます(リポジトリが勝手に拡張を差し込めないように)。
- 試用の設定ディレクトリを切り替える `PI_CODING_AGENT_DIR` は、Pi の機能です。

## 演習
1. `scripts/install.sh --dry-run` の出力を読み、**どのファイルが、どこにリンクされるか**を、自分の言葉で説明する。
2. 試用の設定ディレクトリで、`harness.json` を作り、`{"selectModelOnStartup": false}` にして、起動時の選択画面が出なくなることを確かめる(`<設定ディレクトリ>/harness.json`)。
3. `agent/extensions/harness/instructions/main.md` に 1 行足して `/reload` し、AI の振る舞いが変わるかを見る(**これは、非決定論の指示**。ガードとの違いを体感する)。
