# 未決事項

- [ ] Go のどのモデルを、どの用途に使うか(サブエージェントの既定は DeepSeek V4.1 Flash)
- [ ] 3 系統のモデルの使い分け(切り替え運用)
- [ ] API キーの保管方法(環境変数か auth.json か)
- [ ] Linux 側の音声入力拡張の選定(decisions/005)
- [ ] デスクトップ PC にマイクがあるか
- [ ] Aqua Voice の料金と日本語の精度

## リポジトリの刷新(repo-redesign-plan.md / decisions/010)
- [ ] ubuntu-dotfiles との関係(このリポジトリを設定の正本にするか、dotfiles に統合するか)
- [ ] 刷新後の既定ブランチ名(現在は `agent/bootstrap-harness`)
- [ ] 刷新の作業ブランチ `redesign/v2` のコミットと push

## 実現可能性の評価から出た論点(feasibility-assessment.md 参照)
### サブエージェント(subagent-design.md / decisions/009: 保留)
- [ ] 方式(A: 公式サンプル改造 / B: pi-subagents / C: SDK 自作)。保留。A を暫定の前提とする
- [ ] 並列の書き込み(worktree を分ける運用)を最初から入れるか
- [ ] サブエージェントを使うかどうかの判断基準(ルールか、モデルの判断か)
- [ ] 方式 B を試す場合: 親の `tool_call` ガードが子のツール呼び出しにも効くか(未確認)
- [ ] worker が `subagent` ツールを再帰的に呼べないようにする(確認と対策)

### サンドボックス(sandbox-options.md / decisions/008)
- [ ] 方針: 公式のものを使う(決定)。**公式の `sandbox/` サンプルは 1.5.0 で削除済み**。現在の公式は Gondolin / Docker 系
- [ ] 第一候補の Gondolin で、プロジェクトの検証コマンドと Nix の環境をゲスト内で動かせるか
- [ ] Gondolin は「実験的」。許容するか。駄目なら素の Docker、またはコミュニティ製(@erichll/pi-sandbox など)
- [ ] VM 内からホストの環境変数が見える問題への対処(API キーの渡し方)
- [ ] `/dev/kvm` が使えるか(QEMU の要否)
- [ ] サンドボックスの内側から GitHub に書き込めるようにするか、外の専用ツールに限定するか
- [ ] 子プロセス(サブエージェント)も隔離するか

### Pi の導入(install-npm-global.md / decisions/007)
- [ ] 入っている Node の版(22.19 以上か)と、`npm install -g` の書き込み先(decisions/007 の確認コマンド)
- [ ] 更新の運用(版の固定と、手動更新の頻度)
- [ ] 資料の「`npm install -g` は許可なしで通さない」との整合(更新はユーザーが手動で行う案)

### その他
- [ ] Codex の使用率: `/login openai-codex`(従来のログイン)を使うか、Codex CLI を併用するか
- [ ] 使用率の拡張の選定(導入前にソースを確認)
- [ ] Anthropic の新モデル(Fable 5.2 等)が Pi の内蔵カタログにあるか(`pi --list-models`)
- [ ] 実装の順序
- [ ] 資料から MacBook 側(#114)の記述を削除する(不要と確定)

## 将来メモ(今は検討しない)
- Meta の Muse や Grok のボットなど、他のエージェントから Pi を呼び出せるようにする(decisions/003)

## 解決済み
- PyCodingAgent の実体 → Pi (pi.dev)。decisions/001
- Claude の呼び出し経路、プロバイダ構成 → decisions/002
- Pi の使い方(TUI 主体、リモートは Tailscale 経由で構築済み) → decisions/003
- 音声入力の方式 → 単体は Pi 拡張、MacBook からは Aqua Voice。decisions/005
- Pi を動かすマシンの OS → Ubuntu(NixOS は見送り)。decisions/004
- 防御の前提(ブランチ保護)・利用状況の表示方針・MacBook 側の仕組みは不要 → decisions/006
