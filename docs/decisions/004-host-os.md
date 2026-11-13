# 004: Pi を動かすマシンの OS は Ubuntu

- 日付: 2026-11-13
- 状態: 決定

## 背景
Pi をどのマシンで動かすかが、拡張やツールの選択に影響する。

## 決定
- Pi を動かすのは Ubuntu のデスクトップ PC とする。NixOS は使わない
- 手元のノート PC は MacBook。Tailscale 経由でデスクトップ PC に接続して使う(decisions/003)

## 理由
- ユーザーの NixOS 使用経験から、Nix でのバージョン管理は負担が大きいと判断した
  - 最新版が Nix で使えるようになるまでに時間がかかる
  - Nix にない最新版を使うには自分でビルドする必要があり、時間がかかってストレスになる
- Pi は更新が速く、OpenCode Go も新しい版を前提にしている。最新版を素早く導入できる環境が必要
- 拡張や音声まわりを試行錯誤する段階で、npm の拡張やビルド済みバイナリがそのまま動く環境が望ましい

## 却下した案
- NixOS: 環境の再現性は魅力だが、上記のバージョン追従とビルド時間の問題から見送る

## 調査メモ: Ubuntu と NixOS の比較(検索で得た情報。実機では未検証)
- 暫定の推奨: 当面は Ubuntu。理由は、拡張や音声まわりを試行錯誤する段階であること、Pi の更新が速く Go も新しい版を前提にしていること
- NixOS の面倒な点
  - `/nix/store` が書き込み禁止のため、拡張の `npm install` が失敗することがある。npm の保存先を `~/.pi/npm/` などに向けて回避する例がある
  - ビルド済みバイナリは `nix-ld` を有効にしないと動かないことがある。ローカル Whisper 系の拡張(Rust ビルドや Python)は要注意
  - nixpkgs の Pi は版が古いことがある(0.58.3 を確認。ドキュメントは 0.81.1 を確認)。コミュニティの flake(lukasl-dev/pi.nix など、Home Manager 用モジュール付き)で緩和できる可能性がある
- ffmpeg 自体は NixOS でも簡単に入れられる。先の「工夫が要りそう」は大げさだった
- NixOS の利点: 環境全体の再現性、設定の宣言的管理
- 参考: https://discourse.nixos.org/t/pi-coding-agent-how-to-install-npm-extensions/77030 ,
  https://discourse.nixos.org/t/pi-flake-nix-flake-for-pi-coding-agent-nixos-home-manager-modules/78034

## 未解決事項
- Ubuntu のバージョン(LTS を想定。要確認)
- Pi と Node.js の導入方法(npm のグローバル導入先、バージョン管理ツールの要否)

## 補足(2026-11-13)
- ユーザー資料では、Ubuntu 上でも Nix(home-manager、プロジェクトごとの Nix 環境)を使う運用になっている。見送ったのは NixOS(OS 全体)であり、Nix 自体ではない
- ただし Pi 自体を home-manager / nixpkgs 経由で入れると、版が古くなりやすい問題が再発する。Pi の導入経路は未決(feasibility-assessment.md の要確認事項 1・2)
