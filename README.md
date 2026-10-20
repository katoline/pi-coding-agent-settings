# Pi Coding Agent harness

インストール済みの Pi を前提とした、役割分担・独立レビュー・品質ゲート付き開発ハーネスです。Pi 1.3.0 / Node 24 系で検証します。現在のパッケージ名は `@earendil-works/pi-coding-agent` です。

## 導入

macOS / Linux、Pi、Docker Engine または Docker Desktop、Git、GitHub CLI が必要です。Nix は開発ツールを固定する場合に使用します。Windows は WSL2 上で利用してください。

この設定リポジトリは **編集対象のプロジェクトと別の場所** に置いてください。信頼する実行コードとして扱うため、自分自身を作業エージェントに編集させる起動は拒否します。

```bash
cd /path/to/pi-coding-agent-settings
nix develop                 # Nix を使用する場合。なくても Node >=22.19 で次に進めます
npm ci --ignore-scripts
npm run check
node scripts/harness.mjs build
```

Pi CLI は PC にあるものを前提に起動確認します。サンドボックス内では Dockerfile の Pi 1.3.0 を使用し、ホストと分離します。ホストのグローバル Pi 設定・拡張・MCP・SSH・GitHub トークンは取り込みません。

Pi の認証ファイルから **必要なモデルプロバイダーだけを含む専用 auth.json** を用意し、次のようにパスを設定してください。値をこのリポジトリへコピーしないでください。OAuth 更新が必要な場合はホスト Pi で更新してください。コンテナ内では読み取り専用です。

```bash
export PI_HARNESS_AUTH_FILE=/absolute/path/to/provider-only-auth.json
```

`harness.config.json` の `models` は、`pi --list-models` で使える実際のモデル ID に設定します。`null` は既定モデルを利用します。利用不能なモデルを自動的に他へ置換しません。調査は高速モデル、設計・レビューは高精度モデル、といった配分にできます。別プロバイダーも、その認証があれば指定できます。

## 既存プロジェクトで作業

対象は npm プロジェクトが既定です。対象側に以下を用意してください。

- `.gitignore` に `.harness/`。作業記録・PR メタデータをコミットしないためです。
- `package-lock.json` と、Biome・型チェック・意味のあるテスト・必要なビルドを実行する `npm run check`。
- `AGENTS.md` に要求・受け入れ条件・既存システムの制約。秘密値は書かないでください。
- GitHub に `Quality` という名前の workflow。push イベントでも動かし、検証が成功したときだけ workflow 全体が成功するようにします。このリポジトリの `.github/workflows/quality.yml` が例です。

```bash
cd /path/to/target-project
git switch -c agent/my-feature
# 動作確認だけ。Git への書き込みはしません
node /path/to/pi-coding-agent-settings/scripts/harness.mjs run "$PWD" '受け入れ条件を含む実装依頼'
```

この起動は raw shell を渡しません。ファイル調査・編集、読み取り専用の調査/計画/レビュー委譲、設定済みの検証コマンドを利用します。子プロセスにも同じコンテナ制限が適用されます。起動時にはコンテナ専用の一時 node_modules に `npm ci --ignore-scripts` を実行します。ホスト側の node_modules は共有せず、macOS/Linux の依存関係の混在を避けます。起動ごとにインストールするため、その時間も実行予算に含まれます。

`harness.config.json` の `checks` は shell 文字列ではなく argv 配列です。既存サービスの言語、ビルド、結合テストに合わせて信頼する設定側で調整します。既定の隔離検証は `npm ci --ignore-scripts` の後に指定コマンドを実行します。ネイティブ依存のビルドスクリプトや外部 DB が必須のサービスには、レビュー済みの検証用イメージ・サービス構成を追加してください。必要な検証を削って対応しないでください。

## 実装から PR まで自動実行

**次のコマンドは commit・push・PR 作成/更新を実行します。** 開始時に対象の作業ツリーが clean であることが必須です。

```bash
node /path/to/pi-coding-agent-settings/scripts/ship.mjs /path/to/target-project '実装依頼と受け入れ条件'
```

処理順序は次の通りです。

1. 調査・計画 → 実装 → ローカル検証 → 独立レビュー。
2. エージェントが `.harness/publish.json` に、コミット単位・対象パス・PR タイトル/説明を記録。
3. ホスト側が全変更の過不足と重複を検査し、各コミットについて **ステージ済みツリーを一時ディレクトリに展開**。
4. 隔離コンテナで依存関係を再インストールし、検証と別コンテキストの読み取り専用レビューを実施。明示的な `Verdict: PASS` が必須。
5. 検証済みツリーと index が一致するときだけコミット。中間コミットも検証必須。
6. HEAD を再検証・再レビューし、`origin` の同名 `agent/*` ブランチへ明示的 refspec で push。
7. その SHA の push に対する `Quality` CI 成功を待ち、PR 作成/更新。説明は管理マーカー内だけを更新し、外側の人間の追記を保持。

失敗時は処理を停止します。作成済みコミットや push を自動で取り消しません。エラーと作業ツリーを確認して該当段階から再開してください。モデルのレビューは品質保証の証明ではありません。GitHub 側の人間のレビューも併用してください。

手動で段階ごとに実行する場合:

```bash
cd /path/to/target-project
git add -- src/example.ts tests/example.test.ts
node /path/to/pi-coding-agent-settings/scripts/git-guard.mjs commit 'feat: add example behavior'
node /path/to/pi-coding-agent-settings/scripts/git-guard.mjs push
node /path/to/pi-coding-agent-settings/scripts/git-guard.mjs pr 'Add example behavior' /path/to/pr-body.md
# 既存 PR を更新する場合は pr-update。body-file は人間の追記を含めた全文です。
```

`gh auth login` はホスト側で行います。モデルのプロバイダー認証とは別です。origin は単一の github.com HTTPS/SSH URL、作業ブランチは `agent/*` のみ対応します。force push・main/master/default branch への操作、リモートブランチ削除は提供しません。リンクされた Git worktree は未対応です。並列実行で同じ作業ツリーを変更しないでください。

## 安全性の境界

- Docker は root filesystem を読み取り専用にし、特権と capability を落とし、書き込み可能なホスト領域を対象プロジェクトだけに限定します。`.git` は読み取り専用の別 mount です。一時ファイルはコンテナ内 `/tmp` にあります。
- ファイルツールも実パスを検査し、外部・symlink 経由・Git metadata への書き込みを拒否します。このチェック単独は OS サンドボックスの代わりではありません。
- 認証ファイルの読み取りはモデルプロセスに必要です。信頼しない拡張・コードに秘密を渡さないでください。ネットワークはモデル API・npm 用に有効で、宛先制限はこの実装の対象外です。
- 生の `pi` をホストで起動したり、手動で `git push` した場合、このハーネスのガードは適用されません。ローカル管理者による迂回を阻止する仕組みではありません。
- **GitHub Rulesets は別途必須**です。main/master/default branch の直接 push・force push・削除を禁止し、PR、required status `quality`、レビューを必須にしてください。エージェント・管理者の bypass も確認してください。このリポジトリを置くだけでは GitHub の保護は有効になりません。
- CI ファイルやポリシーを変更できる主体は検証も弱められます。実際のチーム名で CODEOWNERS を設定し、ポリシー変更に人間の承認を要求してください。

## 新規プロジェクト

空のプロジェクトへ設定を生成できます（既存ファイルは上書きしません）。

```bash
node /path/to/pi-coding-agent-settings/scripts/init-project.mjs /path/to/new-project
```

アプリの仕様は生成しません。ソースと実際の回帰テストを追加し、`nix develop` 内で初回 `npm install --ignore-scripts` を実行して lockfile を作成してください。テストがない状態では検証を拒否します。

`templates/project-checklist.md` に Nix・Biome・CI・権限設定の導入項目があります。`flake.nix` / `flake.lock`、`biome.json`、Quality workflow を土台にして、プロジェクト固有の package.json と実際のテストを追加してください。Nix と言語側 lockfile は両方コミットします。既存サービスのツールチェーンを無条件に置き換えないでください。

## 開発と検証

```bash
npm ci --ignore-scripts
npm run check
```

テストは保護ブランチ、CI の SHA/イベント/成功判定、パス逸脱、symlink、ツール制限、レビュー権限、PR 説明の保持を確認します。Docker の隔離は実機スモークテストでも確認します。プロバイダー認証が必要なモデル呼び出しと実際の GitHub 書き込みは、利用者の PC と対象リポジトリで別途確認してください。

参考: [Pi 公式](https://github.com/earendil-works/pi)、[公式 subagent 例](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)、[Armin Ronacher の agent-stuff](https://github.com/mitsuhiko/agent-stuff)。公開拡張の一括導入や自動信頼は行いません。
