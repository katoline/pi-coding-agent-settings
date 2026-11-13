# 005: 音声入力は接続元によって使い分ける

- 日付: 2026-11-13
- 状態: 決定(拡張の選定は未定)

## 背景
Pi の TUI を音声で操作したい。Pi 拡張の音声入力は、Pi が動くマシンのマイクで録音する。そのため、MacBook から Tailscale 経由で接続している間は、声が拡張に届かない。

## 決定
| 利用場面 | 音声入力の方式 |
|---|---|
| デスクトップ PC(Linux)単体で使うとき | Pi の拡張機能を使う |
| MacBook から接続して使うとき | Aqua Voice(MacBook 側で動く)を使う |

## 理由
- Aqua Voice は Mac / Windows 向けで Linux 非対応。Linux 上の Pi 単体では使えない
- Aqua Voice は MacBook のターミナルのカーソル位置に文字を入力するので、Pi が遠隔でも使える
- 拡張は、Pi を動かすマシンの前にいるときだけ有効

## Linux 上の Pi 拡張の候補(調査済み、未選定)
- pi-voice-stt: Ctrl+R で録音開始・停止して送信。ffmpeg で録音。文字起こしは OpenAI 互換または Mistral(クラウド)
- pi-extension-stt: faster-whisper によるローカルの文字起こし
- @benjaminjamesxyz/pi-voice-input: Whisper をローカルで実行。Linux 向け。Rust のビルドが必要
- pi-vox: ElevenLabs(クラウド)で文字起こし
- picrophone: 端末内処理だが macOS 専用のため対象外
- 注意: Pi パッケージは任意のコードを実行できる。導入前にソースを確認すること

## 却下した案
- 音声入力を Pi 拡張だけにする案: 遠隔接続時に使えない
- Aqua Voice だけにする案: Linux 上の Pi 単体では使えない

## 未解決事項
- Linux 側の拡張の選定(ローカル処理かクラウドか。日本語の精度、遅延、マイクの有無)
- デスクトップ PC にマイクがあるか
- Aqua Voice の料金プランと日本語の精度の確認
