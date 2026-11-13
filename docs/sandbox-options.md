# サンドボックスの選択肢(作業を止めないための防御)

- 日付: 2026-11-13
- 状態: 検討中(方針は決定: 公式のものを使う。具体的な方式は要確認)
- 注意: 各パッケージの情報は pi.dev のパッケージページと README によるもの。**ソースコードは読んでいない。実機でも試していない。**

## 訂正(2026-11-13): 公式の `sandbox/` サンプルは、Pi 1.5.0 で削除されていた
- このあとの「2-1. 公式サンプル `sandbox/`」は、**Pi 0.81.1 まで同梱されていたもの**。最新の 1.5.2 では、CHANGELOG に「ネイティブ OS の `sandbox/` 拡張サンプルと、その依存を削除した。Gondolin のサンプルか、コンテナ化のガイドを使うこと」とある(1.5.0、2026-11-02)。前回の回答で「公式サンプルの `sandbox/` を使える」と書いたのは、古い版のドキュメントによる誤りだった。
- **現在の公式の選択肢**(Pi 1.5.2 の `docs/containerization.md` とサンプル)

| 方式 | Pi が動く場所 | 隔離されるもの | 認証情報 | 備考 |
|---|---|---|---|---|
| **Gondolin 拡張**(公式サンプル) | ホスト | 組み込みツール(read、write、edit、bash、grep、find、ls)と `!` コマンドを、ローカルのマイクロ VM に流す | Pi の認証情報はホストに残る。**ただし、コマンドはホストの環境変数を引き継ぐ**(公式の表) | Node ≥ 22.19(npm 上の gondolin 0.14.0 の要求。サンプルのコメントの「23.6」は古い)。Linux x86_64 で `/dev/kvm` が使えれば、同梱の libkrun で動き、QEMU は不要。使えなければ QEMU(`qemu-system-x86`)が要る。Gondolin 自身は**「実験的」と明記**。Apache-2.0 |
| Docker(素の) | コンテナ | Pi、ツール、`!` コマンド、拡張のすべて | API キーはコンテナに渡す | もっとも単純。作業ディレクトリを `-v` でマウント |
| Docker Sandboxes(`sbx`) | 管理されたサンドボックス | 同上 | **実キーはホストに残り、プロキシが置き換える** | キーを渡したくない場合に向く |
| OpenShell(NVIDIA) | ローカルまたはリモートのサンドボックス | 同上 | ポリシーで制御 | ゲートウェイが必要 |

- **どの公式の方式も、「ホストとは別の環境の中で動かす」型**である。ホストの道具(Nix の環境、`node`、`biome`、`gh` など)は、そのままでは中から使えない。
  - Gondolin のゲスト(中のシステム)は Alpine ベースで、既定のイメージに git、Node、npm が入っているかは、確認できなかった。**プロジェクトの検証コマンド(資料の「検証」)や、Nix の環境を、中で動かせるようにするには、イメージの作り込みが要る可能性が高い**(未確認)。
  - 公式のサンプルは、作業ディレクトリだけを `/workspace` としてゲストにマウントする。
- **ホストの道具をそのまま使う「OS の機能で包むタイプ」(bubblewrap など)は、現在はコミュニティ製(2-2 の拡張)だけ**になった。
- Pi 自身の注意: Gondolin 方式は、他の拡張のツール(自作のサブエージェントなど)は**ホストで動く**。サブエージェントも隔離するには、子にも同じ仕組みを効かせる必要がある。

## 結論
- **できます。** Pi 本体に組み込みのサンドボックスはありませんが、拡張として作る仕組み(ツールの差し替え、`tool_call` の書き換え)があり、**公式の Gondolin 拡張(マイクロ VM)と、コンテナ化のガイドがあります。** Claude Code と同じ部品(bubblewrap など)を使うタイプは、かつて公式サンプルがありましたが削除され、現在はコミュニティ製の OSS です(上の訂正を参照)。自作する必要は、まず無いでしょう。
- サンドボックスの目的は、「止める」のではなく、「**境界の内側なら確認なしで自由にやらせる**」ことです。文字列検査で一つずつ止める方式を、OS が強制する境界に置き換えれば、確認の頻度が減り、作業が止まりにくくなります。
- ただし、サンドボックスで守れないものがある(後述)。`tool_call` のガードと GitHub のブランチ保護は、併用が前提です。

## 1. Claude Code・Codex のサンドボックスの仕組み
| | Claude Code | Codex CLI |
|---|---|---|
| Linux の仕組み | bubblewrap(ファイルシステムの隔離)+ プロキシ(ネットワーク。`socat` が必要)。seccomp は任意 | 情報源によって食い違う。bubblewrap + seccomp が現行で、Landlock は旧方式という説と、その逆の説がある(要確認) |
| macOS | Seatbelt | Seatbelt |
| 書き込み | 作業ディレクトリ(とその配下)に限定 | `workspace-write` モードで作業領域に限定。`.git` は既定で保護 |
| ネットワーク | プロキシ経由でドメインを許可・拒否 | `workspace-write` の既定は無効とする説明が多い(情報源で食い違う。要確認) |
| 範囲 | bash ツールとその子プロセス | 実行するコマンド |
| 目的 | 境界の内側のコマンドは、確認なしで実行できるようにする | 同様 |

OpenCode のサンドボックスについては、調べた範囲では確認できませんでした。

出典: [Claude Code のサンドボックス](https://code.claude.com/docs/en/sandboxing)、[Codex の説明(第三者の解説を含む)](https://codex.danielvaughan.com/2026/05/03/codex-cli-sandbox-internals-seatbelt-bubblewrap-landlock-windows-dacl/)

## 2. Pi で使える選択肢

### 2-1. 公式サンプル `sandbox/`(**1.5.0 で削除済み。0.81.1 までの情報**)
- Pi に同梱の拡張。`@anthropic-ai/sandbox-runtime`(0.0.26)で、**bash ツールを差し替え**、ファイルシステムとネットワークを OS の機能で制限する(Linux は bubblewrap)。
- 設定: `~/.pi/agent/extensions/sandbox.json`(全体)と `<プロジェクト>/.pi/sandbox.json`(プロジェクト別)。書き込み許可、読み取り拒否(`~/.ssh`、`~/.aws`)、書き込み拒否(`.env`、`*.pem`、`*.key`)、許可ドメインを書く。
- Linux で必要なもの: `bubblewrap`、`socat`、`ripgrep`。
- 注意: サンプルは bash の差し替えが中心。`write` / `edit` ツールの書き込み制限は別途 `tool_call` で行う必要がある。

### 2-2. コミュニティ製の拡張(pi.dev で公開)
いずれも OSS。**全権限で動く拡張なので、導入前にソースの確認と版の固定が必要。**

| パッケージ | 版・ライセンス | 仕組み | 特徴・制限 |
|---|---|---|---|
| [@erichll/pi-sandbox](https://pi.dev/packages/@erichll/pi-sandbox) | 0.29.2(2026-11-03)、Apache-2.0 | `sandbox-runtime`(bubblewrap + seccomp) | 静的な方針で、許可範囲外の読み書きは拒否(fail closed)。ネットワークは「拒否リスト → 許可リスト → 厳格モード → 接続ごとの確認」の順。**サブエージェントも包む**(各ワーカープロセスごと)。Pi の設定、git フック、秘密ファイル(`.env`、`*.pem`、`*.key`)を書き込み禁止にする。制限: `sandbox-runtime` は研究プレビュー。`github.com` のような共用ホストを許可すると外部への持ち出しは防げない。パッケージマネージャ用のホストは手動で追加が必要。設定変更には再読み込みが必要 |
| [@yuru7/pi-sandbox](https://pi.dev/packages/@yuru7/pi-sandbox?name=pi-sandbox) | 0.5.0、MIT | bubblewrap、なければ Landlock | 書き込みは作業領域と一時領域だけ。**読み取りは無制限(`~/.ssh` も読める)、ネットワークは常に許可。** 「一度拒否されたら、理由を添えて 1 回だけ再試行できる」仕組みがあり、その承認を別のレビュー用モデルに任せられる(`auto-review`)。承認用のモデルにコマンドと直近の会話が送られる |
| [@yandy0725/pi-sandbox](https://pi.dev/packages/@yandy0725/pi-sandbox?name=pi-sandbox) | 1.8.1、MIT | bubblewrap / Landlock | 作業領域は書き込み可、他は読み取りのみ。fail closed |
| [@nqbao/pi-sandbox](https://pi.dev/packages/@nqbao/pi-sandbox) | — | bubblewrap | bash を包み、ファイル系ツールの書き込みも制限。対応する仕組みが無ければ bash は実行されない(fail closed) |
| [@oddsjam/pi-sandbox](https://cdn.jsdelivr.net/gh/oddsjam/pi-sandbox@main/README.md) | — | `sandbox-runtime`(bubblewrap + seccomp) | プロキシ経由で、ドメインごとの承認を求める |

### 2-3. Pi 全体、または道具の実行先を隔離する方法(公式の containerization ドキュメント)
| 方式 | 隔離されるもの | 備考 |
|---|---|---|
| Gondolin 拡張(公式サンプル) | 組み込みツールと `!` コマンドを、ローカルのマイクロ VM に流す | 認証情報はホストに残る。Node ≥ 23.6 と QEMU が必要 |
| Docker | `pi` プロセス全体 | 作業ディレクトリを `-v` でマウント。API キーはコンテナ内に入る |
| OpenShell(NVIDIA) | `pi` プロセス全体(ポリシー制御の sandbox) | ゲートウェイが必要。モデルの API キーをサンドボックスの外に置ける構成がある |

## 3. 「止めない」ための設計の考え方
Pi は、標準では**ツール呼び出しの前に確認を出さない**(公式ドキュメントに明記)。止まる原因は、資料の仕様で自分たちが入れる確認と拒否です。サンドボックスを入れると、次のように整理できます。

| 項目 | サンドボックスなし(文字列検査) | サンドボックスあり |
|---|---|---|
| 作業領域の外への削除・書き込み | `rm` の引数を解析して拒否(`find -delete`、`python -c` はすり抜ける) | **OS が拒否。** 経路を問わず止まる |
| `.env`・秘密鍵・トークンの読み取り | `cat .env` などを文字列で検査(網羅できない) | **`denyRead` で OS が拒否。** 経路を問わない |
| 外部への通信 | 制限なし | 許可ドメイン以外は拒否(`erichll` など) |
| 作業領域の内側での削除 | 確認が必要になりうる | 境界の内側なので、確認なしで進められる |
| 利用者の操作が必要なもの(sudo、秘密情報の用意) | 保留にして最後にまとめて依頼 | 同じ |

### サンドボックスで守れないもの(併用が必要)
1. **作業領域の内側の破壊。** `.git` の削除、`git reset --hard` などは、境界の内側なので止まらない → `tool_call` のガード(資料の Git 規則)が必要。
2. **git / gh の認証情報。** サンドボックス内で `git push` や `gh pr merge` を実行できるなら、認証情報が使える。**対策案: コミット・push・PR・マージは、サンドボックスの外(拡張がホスト側で実行する専用ツール)に出し、サンドボックス内の bash からは GitHub への書き込み権限を持たせない。** これは資料の「メインセッションからだけ許可」とも相性が良い。
3. **許可したドメインへの持ち出し。** `github.com` のような共用ホストを許可すると、そこ経由の情報流出は防げない。
4. **サンドボックス自体の不備。** `sandbox-runtime` は研究プレビュー。Pi の拡張や Pi 自体の初期化など、境界の外で動く部分もある。

### 判断を人でなくモデルに任せる方式
`@yuru7/pi-sandbox` の `auto-review` は、「拒否されたら、別のモデルが許可か拒否を決めて 1 回だけ再試行できる」仕組みで、**作業が止まらない**。引き換えに、コマンドと直近の会話がレビュー用モデルの API に送られ、絶対の安全保証はない(パッケージ自身が明記)。採用するなら、レビュー用モデルを、Go の安いモデルにするなど、運用の判断が要る。

## 4. Ubuntu での注意(bubblewrap 系を選ぶ場合のみ。Gondolin・Docker では関係しない)
- **Ubuntu 24.04 以降は、AppArmor が一般ユーザーによる user namespace の作成を制限している。** bubblewrap は `setting up uid map: Permission denied` で失敗しうる。よく使われる対処は、`/etc/apparmor.d/bwrap` に bwrap 用のプロファイル(`flags=(unconfined)`、`userns,`)を作り、`systemctl reload apparmor` する方法、または `kernel.apparmor_restrict_unprivileged_userns` を無効にする方法([参考](https://etbe.coker.com.au/2024/04/24/ubuntu-24-04-bubblewrap/))。**確実な唯一の解決策は見つからなかった。** 実機で確かめる必要がある。
- 必要なパッケージ(`bubblewrap`、`socat`、`ripgrep`)の導入と上記の設定には `sudo` が要る。資料の方針(`sudo` はエージェントに実行させない、`apt` は許可制)から、**これはユーザーが 1 回だけ手で行う作業**になる。dotfiles に手順を書いておく。
- Ubuntu のバージョンを教えてほしい(24.04 か、それ以降か)。

## 5. 暫定の推奨(訂正後)
ユーザーの方針は「Pi の公式のものがあれば、それを使う」。

1. **第一候補: 公式の Gondolin 拡張。** Pi の公式サンプルで、`/workspace` だけをゲストに出すため、作業領域の外への書き込みと、ホストの秘密情報(`~/.ssh` など)の読み取りは、構造的に止まる。bash だけでなく、read / write / edit なども VM に流れる。
   - **ただし、次の 3 点を、導入前に確かめる必要がある。**
     1. **プロジェクトの検証コマンドと Nix の環境を、ゲストの中で動かせるか。** 動かせないなら、イメージの作り込みか、別の方式が要る。
     2. **「実験的」である点。** 不具合や仕様変更がありうる。
     3. **ホストの環境変数の引き継ぎ。** API キーを環境変数で渡していると、VM の中のコマンドから見える。キーは `auth.json` の `!コマンド` 形式で渡す、または環境変数を絞る。
2. **第二候補: 素の Docker で Pi 全体を包む(公式のガイドどおり)。** 子プロセス(サブエージェント)や拡張もまとめて包まれる。イメージにプロジェクトの道具を入れる必要がある(Gondolin と同じ課題)。API キーはコンテナに入る。
3. **第三候補: コミュニティ製の OS サンドボックス(`@erichll/pi-sandbox` など)。** ホストの道具をそのまま使える一方、公式ではなく、Ubuntu 24.04 以降では AppArmor の設定が要る(4 節)。
4. どの方式でも、層は次のとおり重ねる(変わらない)。
   1. サンドボックス(OS・VM の境界)
   2. `tool_call` のガード(作業領域の内側の破壊、Git 規則、サブエージェントの制限)
   3. GitHub のブランチ保護(サーバー側。**初回の push の前に必ず設定する**)
5. git / gh の書き込み系は、サンドボックスの外に出す専用ツールにする案は、そのまま有効(「守れないもの」の 2)。Gondolin では、他の拡張のツールがホストで動く性質と合う。
6. 導入前に、ソースを読み、版を固定する。

## 6. 決めてほしいこと(訂正後)
1. 第一候補を Gondolin として、導入前に確認(上の 3 点)を進めてよいか。確認の結果、プロジェクトの検証コマンドがゲストで動かせない場合は、第二・第三候補に切り替える。
2. サンドボックスの内側から GitHub に書き込めるようにするか、書き込みは外の専用ツールに限定するか。
3. (Ubuntu のバージョンは「どうでもよい」とのこと。bubblewrap 系を選ばない限り影響しないので、保留。)

## 参照
- Pi 1.5.2 の `docs/containerization.md`、CHANGELOG(1.5.0 の「Removed」)、サンプル `examples/extensions/gondolin/`
- [Gondolin](https://github.com/earendil-works/gondolin)(実験的、Apache-2.0。npm の `@earendil-works/gondolin` 0.14.0)
- [Pi Containerization](https://cdn.jsdelivr.net/npm/@earendil-works/pi-coding-agent@1.5.2/docs/containerization.md)、[Pi Security](https://cdn.jsdelivr.net/npm/@earendil-works/pi-coding-agent@1.5.2/docs/security.md)
- Pi 同梱サンプル `examples/extensions/sandbox/`(0.81.1 で確認)
- [@erichll/pi-sandbox](https://pi.dev/packages/@erichll/pi-sandbox)、[@yuru7/pi-sandbox](https://pi.dev/packages/@yuru7/pi-sandbox?name=pi-sandbox)、[@yandy0725/pi-sandbox](https://pi.dev/packages/@yandy0725/pi-sandbox?name=pi-sandbox)、[@nqbao/pi-sandbox](https://pi.dev/packages/@nqbao/pi-sandbox)、[@oddsjam/pi-sandbox](https://cdn.jsdelivr.net/gh/oddsjam/pi-sandbox@main/README.md)
- [Claude Code のサンドボックス](https://code.claude.com/docs/en/sandboxing)
- [Ubuntu 24.04 と bubblewrap](https://etbe.coker.com.au/2024/04/24/ubuntu-24-04-bubblewrap/)
