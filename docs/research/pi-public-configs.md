# 調査: Pi の設定を GitHub で公開している人

- 日付: 2026-11-22
- 目的: Pi を使い、設定一式を GitHub で公開している人を知る。(A) スター・フォークが多い個人設定 10 件、(B) 著名なエンジニア 10 人
- 方法:
  - スター数・フォーク数: GitHub の検索 API(2026-11-22 時点の実数)
  - 中身(フォルダ構成、README)と所有者のプロフィール(所属、フォロワー数): 公開ページを読んだ調査エージェントの報告。**私がすべてを自分の目で再確認したわけではありません**
  - 「著名」の判断: フォロワー数と、プロフィールに書かれた肩書き・実績による**私の判断**です
- 限界:
  - GitHub 全体を網羅したわけではなく、検索で見つかった範囲です(Pi 関連の約 1800 リポジトリから、スター 25 以上を対象に絞りました)
  - プロフィールに所属を書いていない人の所属は、確認できませんでした

## A. 個人の設定を公開している、スター・フォークの多い 10 件

| # | リポジトリ | ★ | フォーク | 中身 | 持ち主 |
|---|---|---|---|---|---|
| 1 | [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) | 3.2k | 237 | 拡張・スキル・コマンド・テーマ。npm で `mitsupi` として公開 | Armin Ronacher(Flask の作者) |
| 2 | [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) | 1.3k | 123 | 拡張・スキル。「まとめて入れるものではない」と明記。必要なものだけコピーする | Eero Alvar(フィンランド。YouTube で解説) |
| 3 | [davis7dotsh/my-pi-setup](https://github.com/davis7dotsh/my-pi-setup) | 1.1k | 114 | 拡張・スキル・テーマ・AGENTS.md。「そのままコピーは勧めない」と明記 | davis7(Ben Davis) |
| 4 | [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) | 797 | 160 | 自作拡張の monorepo(`pi install npm:@narumitw/...`) | narumiruna(台北。機械学習エンジニア) |
| 5 | [kunchenguid/dotfiles](https://github.com/kunchenguid/dotfiles) | 700 | 302 | Mac 全体の設定のうち、`home/.pi/agent` に Pi の設定(テーマ・拡張・settings.json・models.json) | Kun Chen |
| 6 | [tmustier/pi-extensions](https://github.com/tmustier/pi-extensions) | 504 | 56 | 拡張集(`pi install git:github.com/tmustier/pi-extensions`) | Thomas Mustier |
| 7 | [HazAT/pi-config](https://github.com/HazAT/pi-config) | 459 | 42 | settings.json・models.json・mcp.json・プロンプト・スキル・拡張。`~/.pi/agent` に丸ごとクローンして使う | Daniel Griesser |
| 8 | [IgorWarzocha/howaboua-pi-stuff](https://github.com/IgorWarzocha/howaboua-pi-stuff) | 420 | 44 | 拡張・スキルの monorepo(`pi install npm:@howaboua/pi-stuff`) | Igor Warzocha |
| 9 | [abhinand5/pi-setup](https://github.com/abhinand5/pi-setup) | 346 | 40 | 拡張・スキル・テーマ・設定例・同期スクリプト | Abhinand(インド。ML エンジニア) |
| 10 | [realchendahuang/pi-config](https://github.com/realchendahuang/pi-config) | 199 | 14 | プラグイン 17・スキル 18・MCP 2 と、1 コマンドの導入スクリプト | realchendahuang |

- 次点: [w-winter/dot314](https://github.com/w-winter/dot314)(143★/17)、[spences10/my-pi](https://github.com/spences10/my-pi)(141★/22)、[pasky/pi-agent-config](https://github.com/pasky/pi-agent-config)(95★/6。settings.json・models.json・AGENTS.md・プロンプト・スキル・拡張がそろった、設定一式そのもの)。
- 範囲外とした、スターの多い個別の拡張: [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access)(1.8k★/334)、[tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)(1.5k★/363)。1 つの機能を配るもので、個人の設定一式ではないため。
- 範囲外とした、Pi 本体の派生: [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)(39.6k★。Pi のフォーク)。
- 4・6・8 は「個人の拡張の集まり」で、`settings.json` や `AGENTS.md` を含む設定一式ではありません。設定一式に近いのは 1・2・3・5・7・9・10 です。

## B. 著名なエンジニア 10 人

| # | 人 | 肩書き・所属(プロフィールの記載) | フォロワー | Pi の公開物 |
|---|---|---|---|---|
| 1 | Armin Ronacher([mitsuhiko](https://github.com/mitsuhiko)) | Flask の作者。Earendil の創業者(Pi の開発元) | 26.7k | agent-stuff(3.2k★)。ほかに pi-ds4・pi-llamacpp など |
| 2 | Mario Zechner([badlogic](https://github.com/badlogic)) | **Pi の作者**(本人のブログ等による。過去の調査で確認。GitHub のプロフィールには明記なし) | 8.1k | [pi-skills](https://github.com/badlogic/pi-skills)(2.7k★/215)、pi-telegram、pi-diff-review、pi-subagent |
| 3 | Kun Chen([kunchenguid](https://github.com/kunchenguid)) | 「元 L8 エンジニア(Meta、Microsoft、Atlassian)」 | 7.2k | dotfiles(700★/302 フォーク)に Pi の設定 |
| 4 | IndyDevDan([disler](https://github.com/disler)) | エージェント開発の YouTuber(所属は未確認) | 4.8k | [pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code)(1.7k★/387。`.pi/`・拡張・justfile を含む Pi の活用例集) |
| 5 | Jeffrey Emanuel([Dicklesworthstone](https://github.com/Dicklesworthstone)) | 元ロング/ショート株式アナリスト。ニューヨーク | 3.6k | [pi_agent_rust](https://github.com/Dicklesworthstone/pi_agent_rust)(2.0k★)。**Pi の Rust 版の再実装**で、設定ではない |
| 6 | Nico Bailon([nicobailon](https://github.com/nicobailon)) | Senior Agent Engineer, Pika Labs | 2.2k | pi-web-access(1.8k★)、pi-subagents、pi-mcp-adapter など、拡張が中心 |
| 7 | John Lindquist([johnlindquist](https://github.com/johnlindquist)) | egghead.io の関係者(所属欄に記載) | 2.3k | [pi-emphasis](https://github.com/johnlindquist/pi-emphasis)(274★)。拡張 1 つ |
| 8 | Joel Hooks([joelhooks](https://github.com/joelhooks)) | egghead の共同創業者。Badass Courses を構築中 | 1.5k | [pi-tools](https://github.com/joelhooks/pi-tools)(87★)ほか、多数の pi-* |
| 9 | Nick Nisi([nicknisi](https://github.com/nicknisi)) | Developer Experience Engineer, WorkOS | 1.2k | [pi-extensions](https://github.com/nicknisi/pi-extensions)(54★) |
| 10 | Daniel Griesser([HazAT](https://github.com/HazAT)) | Senior Director of Engineering, Sentry(プロフィールの README) | 487 | pi-config(459★/42)。設定一式をそのまま公開 |

注意:
- 「世界的な外資系企業で働く」と**プロフィールから確認できたのは**、Daniel Griesser(Sentry)、Nick Nisi(WorkOS)、Nico Bailon(Pika Labs)、Kun Chen(元 Meta・Microsoft・Atlassian)の 4 人です。Google・Meta・Microsoft などに**現在所属**していると明記して、Pi の設定を公開している人は、今回の検索では見つけられませんでした。
- 「設定一式」を公開している人は、1 の Armin、3 の Kun Chen、10 の Daniel Griesser です。ほかは、拡張・スキルの公開が中心です。
- 5 の Jeffrey Emanuel は、Pi を使った設定ではなく、Pi そのものを Rust で作り直したものを公開している人です。**条件に合うか微妙**なので、参考として入れました。
