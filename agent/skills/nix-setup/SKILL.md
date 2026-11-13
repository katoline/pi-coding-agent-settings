---
name: nix-setup
description: プロジェクトの最初の環境構築。Nix の開発環境、Biome(lint・format)、Dependabot の設定、CI(GitHub Actions)をまとめて作る。新しいプロジェクトの開始時に使う。
---

# Nix セットアップ

プロジェクトの最初の環境構築を、1 回で行う。次の 4 つがそろう。

1. **Nix の開発環境:** `flake.nix`(Node.js、Biome、git、gh)と `.envrc`(`use flake`)
2. **Biome:** `biome.json`(lint・format)
3. **Dependabot:** `.github/dependabot.yml`(npm と GitHub Actions を、週次で確認)
4. **CI:** `.github/workflows/quality.yml`(push と pull_request で、lint・テストなどを実行)

あわせて、`package.json`(無ければ最小のもの。`check` スクリプトつき)と、`.gitignore` の必要な行を足す。

## 使い方

このスキルのディレクトリ(この SKILL.md と同じ場所)の `scripts/setup.mjs` を、対象のプロジェクトのディレクトリを指定して実行する。

```bash
node <このスキルのディレクトリ>/scripts/setup.mjs <プロジェクトのディレクトリ>
```

- 既存のファイルは**上書きしない**(「スキップ」と表示される)。既存の設定を変えたいときは、差分を確認して、自分で編集する。
- `--dry-run` を付けると、作るものを表示するだけで、何も書かない。
- 既存のサービスのツールチェーンを、無条件に置き換えない。

## そのあとの作業

1. `nix flake lock`(`flake.lock` を作る)と、`npm install --ignore-scripts`(`package-lock.json` を作る)を実行し、`flake.lock` と `package-lock.json` を、両方コミットする(Nix と言語側のロックファイルは、両方必要)。
2. プロジェクトの実際のソースと、意味のある回帰テストを追加し、`npm run check` に、必要なビルドや機能テストを含める。テストを通すためだけの、中身のないテストは足さない。
3. **GitHub のブランチ保護**(PR 必須、force push と削除の禁止、必須のチェック `quality`)を設定する。初めての push の前に、必ず行う(`harness_ensure_protection` が、確認のうえ設定する)。
4. CI をスキップする設定や、`quality` の名前の変更をしない(ブランチ保護の必須チェックの名前と一致させるため)。
5. 秘密情報は、リポジトリに置かない。設定の例は `.env.example` を使う。
