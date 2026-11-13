# 調査: Pi の自律実行向けサンドボックスの実践例と、構成の比較

- 日付: 2026-11-13
- 出典: 調査エージェントの報告(公式ドキュメント、README、ソース、npm API = 一次。ブログ、HN、第三者の紹介 = 二次)。**私は再確認していない。**「確認できず」は、読めなかった、または記載がなかったもの
- 関連: `docs/sandbox-options.md`(選択肢の整理)、`docs/research/practitioners.md`(実践者の事例)、`docs/research/autonomous-loops.md`

## 結論(調査エージェントの総括)
1. **他人の Pi + サンドボックスの運用報告は、公開情報では薄い。** 実例の大半は README とスレッドの一言コメントで、dotfiles レベルの詳細な報告はなかった。
2. **「サンドボックスの内側で YOLO、外側に限定された push ツール」を、Pi で完成形として実践した公開事例は確認できなかった。** 近い設計は 2 つ。`JWackerbauer/pi-sandbox`(worktree 上で commit し、人間がレビューしてマージ)と、Cogbox の拡張(エージェントが commit し、拡張が push する。ただし push はサンドボックス内で実行される)。
3. **最大の実用課題は、Nix と glibc のツールチェーン。** Gondolin のゲストは Alpine(musl)で、**Gondolin で Nix を使った公開例は見つからなかった。** ホストのパスを透過させる bubblewrap 系が、Nix の環境を最も壊さずに使える。

## 1. 公式の枠組みの、実用上の事実
- **Security ドキュメント:** Pi は、承認なしでモデルの生成したコマンドをユーザー権限で実行する。専用ユーザーでも OS とネットワークは共有される。プロセス全体を、コンテナ・VM・サンドボックスで囲うのが「通常、最強」。組み込みツールだけを囲う方式は狭い(Pi 本体と他の拡張が外に残る)。
- **Gondolin 拡張(公式サンプル)は「PoC の入口」。**
  - `VM.create` に、ラベルとファイルシステム以外のオプションを渡さない。つまり**既定の `alpine-base` イメージで、ネットワーク制限も secrets 設定もない。**
  - ホストの作業ディレクトリを `/workspace` に読み書きでマウントし、read、write、edit、ls、find、bash、grep を VM に差し替える。
  - git と node の導入処理はなく、既定の Alpine が git を含むかは確認できなかった(次の Gondolin の評価では、「git は自分で追加する」)。
  - **VM 内のコマンドは、ホストの環境変数を引き継ぐ。** 資格情報の境界としては使えない。
  - 公式 containerization ドキュメントは Node 23.6 以上と QEMU を要求するが、Gondolin 本体のドキュメントは 22.19 以上(食い違い。npm 上の gondolin 0.14.0 の engines は 22.19)。

## 2. 方式別・事例別

### A. 専用の Linux ユーザー
- 運用分離にはなるが、**OS とネットワークは共有**(公式が明記)。HN でも、共有カーネルや、認証なしで届くローカルサービスが指摘された。

### B. bubblewrap / Landlock(ホストのパスを透過)
| 事例 | 要点 |
|---|---|
| [Palaimon の bin/pi ラッパー(2026-04-22)](https://blog.palaimon.io/posts/coding-agents-bubblewrap-deep-dive/index.html) | `--ro-bind /usr`、作業ディレクトリだけ rw、`--unshare-all --share-net`、HOME を `$PWD/.sandbox-home` に。実質 20〜40 行。Nix、git、サブエージェントには触れておらず、リポジトリ内で動くかは未確認 |
| [jail.nix + bubblewrap(dev.to)](https://dev.to/andersonjoseph/how-i-run-llm-agents-in-a-secure-nix-sandbox-1899) | エージェントは crush と opencode(Pi ではない)。Nix flake から jail を作り、`mount-cwd` と `extraPkgs` で必要なツールだけ入れる。ssh、kubectl、gcloud は意図的に除外。**「Nix プロジェクトを bwrap で包む」設計の参考になる** |
| 落とし穴 | **Ubuntu 24.04 は、AppArmor が非特権の user namespace を制限**する。@erichll の README は、AppArmor プロファイルか sysctl の調整を要求。Claude Code と Codex のドキュメントにも同じ注記がある |

### C. Docker / devcontainer / Podman
| 事例 | 要点 |
|---|---|
| [pi-less-yolo](https://github.com/cjermain/pi-less-yolo)(168 スター、[2026-03-22 の議論](https://github.com/earendil-works/pi/discussions/2520)) | Chainguard の Node イメージ。作業ディレクトリを実パスのままマウント。`~/.pi/agent` を `/pi-agent` に、`~/.gitconfig` を読み取り専用でマウント。API キーは環境変数で転送。`PI_SSH_AGENT=1` で ssh-agent のソケットも転送できる。**ネットワークは無制限**で、作者自身が「less YOLO であって no YOLO ではない」と書く。Nix は未言及。fork の一部は、既定でホストの Docker ソケットをマウントするので、隔離が弱まる |
| [yolo-jail](https://github.com/mschulkind-oss/yolo-jail)(6 スター) | rootless Podman で、**Nix flake からイメージを作る**。Pi は同梱のパックの 1 つ。SSH 鍵、git 認証、クラウドのトークンは中に置かない。`yolo host` で外で実行もできる。gh、ネットワーク、並列の扱いは記載なし |
| Docker Sandboxes(sbx)+ Pi | 公式ドキュメントは、**本物のキーをホストに置き、プロキシが置き換える**手順を公開。Oleg Šelajev の記事(2026-02-16、旧)は、当時は Docker Desktop の nightly が必要で、現行のコマンドは変わっている可能性がある。**sbx が Ubuntu で使えるかは確認できず** |
| HN の mikodin | docker-sandbox に、単一の git リポジトリだけを渡して Pi を動かす(二次) |
| Palaimon Part 3 | Dev Container を推奨。push の方針は書かれていない |

### D. VM(Lima / Incus / microvm.nix / Gondolin)
- **Lima**([bogoyavlensky、2026-06-08](https://bogoyavlensky.com/blog/sandboxing-ai-coding-agents-with-lima/)): 対象は Claude、Codex、OpenCode(Pi ではない)。`agent.yaml` を全文公開。`GITHUB_TOKEN` だけを転送し、gh と git push を使う。mise でツールを管理し、並列作業は git worktree。egress 制限は未解決。
- **microvm.nix**: プロジェクトごとの flake でツールを宣言。HN の cdata は、**ホストの Nix ストアを overlay で共有**し、ローカルの git remote でコードを同期。起動は「数秒」(二次)。Pi は未言及。
- クラウド・Firecracker 系(Daytona、Cogbox、CreateOS、Freestyle)は、多くがホストの Pi のツールだけをリモートに送る形で、ベンダー依存。

### E. Gondolin 系の Pi 拡張(他人の事例)
| 事例 | 要点 |
|---|---|
| [JWackerbauer/pi-sandbox](https://github.com/JWackerbauer/pi-sandbox)(1 スター、127 コミット) | **各エージェントの作業領域を git worktree にして、Gondolin VM で動かす。サブエージェントも専用の worktree を持ち、親のブランチから派生。** `gondolin.json` で、ホストの環境変数を、許可したホスト限定の secret にする(例: `GH_TOKEN` を `api.github.com` に限定)。`/exit-sandbox` で worktree と VM を破棄し、ブランチは残す。**「並列サブエージェント + ブランチでレビュー」に最も近い公開設計。** イメージの中身と Nix は記載なし |
| [pasky/pi-gondolin](https://github.com/pasky/pi-gondolin)(20 スター、2 コミット) | 公式例とほぼ同じ。ゲストイメージは約 200MB。「1 秒未満で起動」は作者の主張で、第三者の計測ではない |
| [nickryand/pi-gondolin-sandbox](https://github.com/nickryand/pi-gondolin-sandbox)(0 スター) | `.gondolin.json` で cpu、memory、`network.allowHosts`、secrets を設定。`Gondolinfile` から自動ビルド、OCI ベースからのビルドにも対応 |
| [@the-agency/vmpi](https://pi.dev/packages/@the-agency/vmpi)(月 187 DL) | **Pi 本体ごと VM に入れる。** 初回に約 5 分かけてベースのチェックポイント(約 300MB)を作り、以降の起動は約 1 秒(README の主張)。既定の Alpine に git、nodejs、npm、python3、ripgrep、sqlite を含む。`~/.pi` は読み取り専用。キーはプレースホルダ方式。`~/.ssh` と `~/.aws` のマウントは拒否。egress は許可ドメイン制。rootfs の空きは約 90MiB と小さい。Linux x86_64 でテスト済み。サブエージェントは言及なし |
| [@howaboua/pi-sandbox](https://www.npmjs.com/package/@howaboua/pi-sandbox)(月 1,146 DL) | Gondolin 上の名前付き永続環境。Node 24 以上、QEMU、KVM が必要。イメージは利用者が用意。外向き HTTP は既定でブロック |
| [Cogbox](https://pi.dev/packages/@cogbox/pi) | 「エージェントは commit のみ、push は拡張が各ターン後に実行」。ただし**クラウドのサンドボックス内で push し、トークンもサンドボックス側に入る** |

## 3. コミュニティ製の OS サンドボックス拡張の比較
npm の月間 DL は 2026-10-13〜11-11。

| 拡張 | 方式と防御範囲 | 設定の難しさ | 更新・人気 | 既知の限界 |
|---|---|---|---|---|
| [pi-sandbox(carderne)](https://github.com/carderne/pi-sandbox) | bash は bwrap か sandbox-exec(Anthropic の sandbox-runtime のフォーク)。read / write / edit は同じ方針で JS が検査。ドメインはプロンプトで許可 | プロンプト運用が前提。**無人運転には不向き** | 0.8.1(11-10)、305 スター、月 7.7k DL | Linux では bash の glob 設定が無視される。`allowedDomains:"*"` などは穴 |
| [@erichll/pi-sandbox](https://github.com/erichll/pi-packages) | bwrap + seccomp + socat。**ファイルシステムは静的な方針で、読みも閉じる(fail closed)。** 未許可の宛先は `pi-auto-review`(LLM 審査)か人間に回す。**サブエージェントは、ワーカーのプロセス木ごとに隔離**(builtin。同時 4、深さ 3) | 高め(bwrap、socat、rg、Ubuntu 24.04 の AppArmor 調整、`pi-permission-system` などの依存) | 0.29.2(11-03)、月 2.3k DL | 許可したホスト経由の持ち出しは防げない。他の拡張が bash を置換する構成は禁止。**`strictAllowlist: true` で無人化できる** |
| [@yuru7/pi-sandbox](https://github.com/yuru7/my-pi-extensions) | bwrap または Landlock で**書き込み制限のみ**。読み取りとネットワークは無制限(`~/.ssh` も読める) | 低い | 0.5.0(11-08)、月 834 DL | 資格情報の読み出しと持ち出しは防げない |
| [@yandy0725/pi-sandbox](https://github.com/yandy/pi-packages) | 同系統(bwrap、landlock、seatbelt、fail-closed)。README 本文は確認できず | 低〜中 | 1.8.2(11-13)、月 1.1k DL | 詳細は確認できず |
| [@nqbao/pi-sandbox](https://github.com/nqbao/pi-sandbox) | bwrap または sandbox-exec。書き込み制限 + **既定で SSH、AWS、gh などのトークンの読み取りを拒否**、`.git/hooks` と `.git/config` を保護 | 低 | 0.2.0(10-27)、月 397 DL | `git config`、`git remote add`、`git push -u` の upstream 設定が失敗。Linux ではバックグラウンドプロセスが死ぬ |
| [@oddsjam/pi-sandbox](https://github.com/oddsjam/pi-sandbox) | sandbox-runtime の bwrap + seccomp + プロキシ。home 配下と `auth.json` は deny | 中(`/sandbox` ウィザード) | 0.1.2(05-12)、月 105 DL | read / write / edit は JS 検査で OS の強制ではない。更新は止まり気味 |
| [@grothesque/sandburg](https://github.com/grothesque/sandburg) | bwrap で bash、grep などを個別に包む。ネットワーク遮断。外側は Sandkasten で Pi 本体を包む推奨 | 高め(2 層) | 0.1.2(10-01)、月 83 DL | Nix や git の動作は記載なし。`!` コマンドは対象外 |

総評: carderne が人気で、erichll が機能面で最も厚い。**「承認なしで長時間」に向くのは、読みもネットワークも閉じる erichll の厳格な構成か、VM 系。**

## 4. Gondolin の実用評価(公式 README と docs から)
- **成熟度:** 約 2.4k スター、README で「experimental」。npm の最新は 0.14.0(2026-10-22)。Issue は 11 月も活発(zombie、OCI ビルド、TLS の MITM など)。
- **Linux:** Node 22.19 以上。x86_64 で `/dev/kvm` に読み書きの権限があれば libkrun が既定、なければ QEMU。`sudo usermod -aG kvm $USER` して再ログイン、`gondolin exec -- uname -a` で確認。
- **イメージ:** 既定は `alpine-base:latest`(約 200MB)。`nodejs` と `npm` は既定の一覧に入っているが、**git は自分で追加する**。`postBuild.commands` で `npm install -g` もできる。
- **OCI ベース:** Debian などを rootfs にできるが、Issue がある(kmod でモジュールをロードできない、非 root のビルドで権限が失われる)。Alpine 以外は限定的なサポート。
- **secrets:** ゲストにはプレースホルダだけを渡し、ホストのデーモンが許可したホスト宛てのヘッダーだけ置き換える。本文、URL のパス、SSH は置き換えない。`allowedHosts` を併用しないと、外向きの通信は開いたまま。
- **制限:** HTTP/2 と HTTP/3 は不可。UDP は DNS のみ。メタデータの多い処理(`git status` など)は遅い。**Issue #162: チャンク転送の HTTP body が二乗時間でパースされ、git push が遅くなる。**
- **node_modules の衝突:** ホストが glibc でゲストが musl なので、`ShadowProvider` の `writeMode:"tmpfs"` で、ホストの `node_modules` を隠す例が公式にある。
- **Nix:** **Gondolin 側の Nix の事例は確認できず。** ゲストは musl で、ホストの `/nix/store` を持ち込む例も確認できなかった。
- **Pi 連携の既知の問題:** Issue #205 — ゲストに `PI_*` のセッション変数が渡らない。

## 5. Claude Code / Codex から移植できるパターン
- **Claude Code**([公式](https://code.claude.com/docs/en/sandboxing)): サンドボックス内は承認なし(auto-allow)、逸脱は通常の権限フロー。書き込みは作業ディレクトリのみで、`.git/hooks` などは書き込み不可。通信はプロキシ経由の許可ドメイン制。**`excludedCommands` で `docker` などだけを外に出し、`allowUnsandboxedCommands:false` で、承認なしの脱出を禁止する。** → Pi では `@erichll` の厳格な構成が最も近い。「外に出すコマンドを最小の許可リストにする」考え方は、そのまま移植できる。
- **Codex**([公式](https://learn.chatgpt.com/docs/sandboxing)): `workspace-write` と `on-request` の組み合わせで、Linux は bwrap。Ubuntu 24.04 では AppArmor のプロファイルが要る。
- **HN の指摘(二次):** Codex の bwrap は、既定で SSH 鍵が見えるので実質装飾、という指摘がある。これは yuru7 型(読み取り無制限)にも当てはまる。

## 6. 推奨構成の案(調査エージェントの設計。**この構成全体を動かした報告は確認できなかった。** 小さく試す前提)
前提: Ubuntu のデスクトップ PC、Node 直入り、Nix の環境、並列のサブエージェント、GitHub への push は限定。

### 案 1(最も再現しやすい): ホスト上の bwrap 拡張 + git worktree + 外側の push ツール
- `@erichll/pi-sandbox` を、`strictAllowlist: true` で、`allowedDomains` に LLM の API だけを入れて使う。サブエージェントは builtin provider(ワーカーのプロセス木ごとの隔離)。各サブエージェントは別の worktree で動かし、エージェントは commit まで。**push と PR は、サンドボックスの外で動く自作の拡張ツール**(または人間の手動 push)に限定する。トークンは、その外側のツールだけが持つ。
- 根拠: パスを透過するので、**直入りの Node とホストの Nix(`/nix` は読み取り専用で見える想定)が壊れにくい。** 読み取りが閉じる。ネットワークは許可リスト。GitHub のトークンは中に置かない。サブエージェントの対応が README に明記。
- 注意: **Ubuntu 24.04 以降は、AppArmor の user namespace 制限を解く必要がある。** カーネル共有なので VM 級の隔離ではない。拡張のツールは Pi と同じ権限でホストで動く(自分で書いたものだけを使う)。**`nix develop` が `/nix/var/nix/daemon-socket` に届くかは要検証。** `github.com` を許可すると、そこが持ち出しの経路になる。

### 案 2(隔離は最強、Nix は代替が必要): Gondolin + JWackerbauer/pi-sandbox(worktree + VM)
- `git`、`nodejs`、`npm`、`ripgrep`、`bash` を入れたイメージを作り、`gondolin.json` で egress を許可リスト制にし、`GH_TOKEN` は `api.github.com` 限定のプレースホルダにする(または push は VM の外)。プロジェクトの Nix の環境の代わりに、必要なツールを apk で入れる。
- 根拠: KVM による隔離で、secrets はゲストに本物が入らない設計。worktree + サブエージェント + ブランチレビューという、並列と push 分離に最も近い公開設計がある。
- 注意: **Nix の再現性が失われ、musl との互換性の問題が出る。** Issue #162(git push が遅い)、Alpine 縛り、experimental。公式例は Pi 本体が外に残り、環境変数を継承する(ホストの環境変数を空にして起動すること)。

### 案 3(Nix を最大限活かす): rootless Podman(または Docker)コンテナ + `/nix` マウント(yolo-jail 型)
- Pi 本体ごとコンテナに入れる。プロジェクトは worktree を実パスで bind し、`~/.pi/agent` はコンテナ専用の volume。SSH、gh、トークンは持ち込まない。API キーは `-e` か、sbx のシークレットのプロキシ。push は外側。
- 根拠: 公式ドキュメントが Docker と sbx の手順を公開。yolo-jail は Nix flake でイメージを作る。Nix の derivation をそのまま持ち込める可能性が高い(未検証)。
- 注意: ネットワークは既定で無制限なので、ファイアウォールか sbx のプロキシで絞る。Docker ソケットを渡すと隔離が崩れる。コンテナ内の Pi は API キーを持つので、プロンプトインジェクションでキーが漏れうる。sbx が Ubuntu で使えるかは確認できず。

### 共通の運用メモ
- サブエージェントごとに git worktree を切り、エージェントは commit まで。push と PR は外側で行う(トークンをサンドボックスの外に残せる)。
- 使い捨てのリポジトリ状態でスナップショットかバックアップを取る。セッションには、コマンドの出力や資格情報が残りうる。
- **優先順位: まず案 1 を 1 日試し、Nix の daemon socket で詰まるなら案 3、より強い隔離が要るなら案 2。**
