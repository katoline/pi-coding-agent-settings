# 007: Pi は npm グローバルで導入する(最新版を使う)

- 日付: 2026-11-13
- 状態: 暫定(懸念点の一覧を提示済み。ユーザーの確認待ち)

## 背景
古いバージョンを使いたくない。home-manager(Nix)経由だと、nixpkgs の版が古くなりやすい(decisions/004 と同じ問題)。

## 決定(暫定)
- Pi は `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` で導入する(Node.js 22.19 以上が必要)
- 懸念点は install-npm-global.md に一覧化した。特に重要なのは次の点
  - グローバルの書き込み先を `~/.npm-global` などのユーザー領域にする(`sudo` と `/nix/store` の問題を避ける)
  - 版を固定し、更新はユーザーが手動で行う(Pi は更新が速く、自作の拡張が壊れうる)
  - 拡張は導入前にソースを読み、版を固定する

## 却下した案
- home-manager(nixpkgs)経由: 版が古くなりやすい

## 追記(2026-11-13)
- Node.js は、**すでに PC に直接入っている**(入れ方と版は未確認)。入手経路の選択は不要になった
- Pi は Node ≥ 22.19 が必要。サンドボックスに Gondolin を使う場合も、gondolin 0.14.0 は Node ≥ 22.19(サンプルのコメントの 23.6 は古い)
- Ubuntu のバージョンは、ユーザーは覚えておらず、重要でないとのこと

## 未解決事項
- 入っている Node の版が 22.19 以上か(下の確認コマンドで見る)
- `npm install -g` の書き込み先が、書き込める場所か(`sudo` が要らないか)
- 更新の運用(固定する版、確認の頻度)

## 確認コマンド(ユーザーが手元の PC で実行)
```bash
node -v
which node
npm config get prefix
```
```bash
ls -ld "$(npm config get prefix)/lib/node_modules"
```
- `node -v` が `v22.19.0` 以上であること
- 一つ目の確認で出た prefix が `/usr` や `/usr/local` のとき、`npm install -g` に `sudo` が要る可能性が高い。その場合は、install-npm-global.md の A2 のとおり、`~/.npm-global` などに prefix を変える
- Gondolin を試すときは、`ls -l /dev/kvm` と `id -nG` の出力(`kvm` グループに入っているか)も確認する
