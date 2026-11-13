#!/usr/bin/env bash
# このリポジトリの設定を、Pi の設定ディレクトリ(既定 ~/.pi/agent)に、シンボリックリンクで配置する。
#
#   scripts/install.sh            配置する
#   scripts/install.sh --dry-run  何も変えず、何をするかを表示する
#
# - 既存のファイルは上書きしない(競合として表示し、スキップする)。
# - auth.json(API キー・OAuth トークン)には触れない。このリポジトリにも置かない。
# - 何度実行しても同じ結果になる(すでに正しいリンクなら、何もしない)。
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
dry=0
[[ "${1:-}" == "--dry-run" ]] && dry=1

conflicts=0

# link <リンク先(リポジトリ内)> <リンクの場所>
link() {
  local src="$1" dest="$2"
  if [[ -L "$dest" ]]; then
    if [[ "$(readlink "$dest")" == "$src" ]]; then
      echo "済み:   $dest"
      return
    fi
    echo "競合:   $dest は別の場所へのリンクです($(readlink "$dest"))。スキップします" >&2
    conflicts=$((conflicts + 1))
    return
  fi
  if [[ -e "$dest" ]]; then
    echo "競合:   $dest がすでにあります。スキップします(内容を確認して、手動で移してください)" >&2
    conflicts=$((conflicts + 1))
    return
  fi
  echo "リンク: $dest -> $src"
  if [[ $dry -eq 0 ]]; then
    mkdir -p "$(dirname "$dest")"
    ln -s "$src" "$dest"
  fi
}

# 拡張(ハーネス本体)
link "$repo/agent/extensions/harness" "$agent_dir/extensions/harness"

# サブエージェントの役割
for f in "$repo"/agent/agents/*.md; do
  link "$f" "$agent_dir/agents/$(basename "$f")"
done

# スキル
for d in "$repo"/agent/skills/*/; do
  d="${d%/}"
  link "$d" "$agent_dir/skills/$(basename "$d")"
done

# プロンプトテンプレート(あれば)
for f in "$repo"/agent/prompts/*.md; do
  [[ -e "$f" ]] || continue
  link "$f" "$agent_dir/prompts/$(basename "$f")"
done

# 設定: すでにある settings.json は、変更しない(内容は、手動で統合する)
link "$repo/agent/settings.json" "$agent_dir/settings.json"

if [[ $conflicts -gt 0 ]]; then
  echo >&2
  echo "競合が ${conflicts} 件ありました。上の表示を確認して、対応してください。" >&2
  exit 1
fi

echo
echo "完了。Pi を起動すると、ハーネスが読み込まれます(拡張を変えたときは、Pi の中で /reload)。"
echo "API キーは、環境変数か、Pi の /login で設定してください(auth.json は、このリポジトリに置きません)。"
