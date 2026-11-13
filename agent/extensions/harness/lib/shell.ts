/**
 * シェルコマンドの解析(ガード用の、保守的な字句解析)。
 *
 * 目的は「実行してよいか」の判定に必要な情報を取り出すこと。完全なシェルの再現ではない。
 * 解析できない・判定できない場合は、呼び出し側が安全側に倒せるよう、`ok: false` や
 * `dynamic: true`(変数・コマンド置換で組み立てられた語)として報告する。
 *
 * 注意: これはサンドボックスの代わりにならない。`python -c` やスクリプト経由の間接実行は
 * 解析できない。OS の境界(サンドボックス)と併用する前提。
 */

export interface Word {
  /** クォートを外した値。変数・コマンド置換は元の文字列のまま残す */
  value: string;
  /** 変数展開・コマンド置換・ANSI-C クォートを含む(実行時まで値が決まらない) */
  dynamic: boolean;
  /** クォートされていない glob / ブレース展開の文字を含む */
  glob: boolean;
}

export interface Redirect {
  op: string;
  target: Word;
}

export interface SimpleCommand {
  words: Word[];
  redirects: Redirect[];
  /** `$(...)`、バッククォート、`sh -c '...'` の内側から取り出したコマンド */
  nested: boolean;
  /** 同じ入力の、より前の(入れ子でない)コマンドで `cd` / `pushd` / `popd` が使われた */
  afterCd: boolean;
}

export interface ParseResult {
  commands: SimpleCommand[];
  /** false: クォートの閉じ忘れなど、解析できなかった */
  ok: boolean;
  /** `eval` や `sh -c "$VAR"` のように、中身を静的に判定できない実行を含む */
  opaque: boolean;
}

const RESERVED_SEPARATORS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "{",
  "}",
  "!",
  "case",
  "esac",
]);

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const CD_COMMANDS = new Set(["cd", "pushd", "popd"]);

interface Builder {
  value: string;
  dynamic: boolean;
  glob: boolean;
  started: boolean;
}

function newBuilder(): Builder {
  return { value: "", dynamic: false, glob: false, started: false };
}

/** `(` から対応する `)` までを返す(クォートと入れ子を考慮)。見つからなければ -1 */
function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function findClosingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function parseShell(input: string): ParseResult {
  const result: ParseResult = { commands: [], ok: true, opaque: false };
  parseInto(input, result, false);
  expandShellInvocations(result);
  markAfterCd(result);
  return result;
}

function parseInto(input: string, out: ParseResult, nested: boolean): void {
  let words: Word[] = [];
  let redirects: Redirect[] = [];
  let cur = newBuilder();
  let pendingRedirect: { op: string } | null = null;
  const heredocs: { delimiter: string; strip: boolean; quoted: boolean }[] = [];

  const endWord = () => {
    if (!cur.started) return;
    const word: Word = { value: cur.value, dynamic: cur.dynamic, glob: cur.glob };
    cur = newBuilder();
    if (pendingRedirect) {
      redirects.push({ op: pendingRedirect.op, target: word });
      pendingRedirect = null;
    } else {
      words.push(word);
    }
  };

  const endCommand = () => {
    endWord();
    if (pendingRedirect) pendingRedirect = null;
    if (words.length > 0 || redirects.length > 0) {
      out.commands.push({ words, redirects, nested, afterCd: false });
    }
    words = [];
    redirects = [];
  };

  const addSubstitution = (inner: string, raw: string) => {
    cur.started = true;
    cur.dynamic = true;
    cur.value += raw;
    parseInto(inner, out, true);
  };

  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i] as string;

    if (ch === " " || ch === "\t") {
      endWord();
      i++;
      continue;
    }

    if (ch === "\n") {
      endCommand();
      i++;
      // ヒアドキュメントの本体を読み飛ばす
      while (heredocs.length > 0) {
        const doc = heredocs.shift() as { delimiter: string; strip: boolean; quoted: boolean };
        let found = false;
        while (i < n) {
          const eol = input.indexOf("\n", i);
          const line = eol < 0 ? input.slice(i) : input.slice(i, eol);
          i = eol < 0 ? n : eol + 1;
          const cmp = doc.strip ? line.replace(/^\t+/, "") : line;
          if (cmp === doc.delimiter) {
            found = true;
            break;
          }
        }
        if (!found) out.ok = false;
      }
      continue;
    }

    if (ch === "\\") {
      if (input[i + 1] === "\n") {
        i += 2;
        continue;
      }
      cur.started = true;
      cur.value += input[i + 1] ?? "";
      i += 2;
      continue;
    }

    if (ch === "#" && !cur.started) {
      while (i < n && input[i] !== "\n") i++;
      continue;
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) {
        out.ok = false;
        return;
      }
      cur.started = true;
      cur.value += input.slice(i + 1, end);
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      cur.started = true;
      i++;
      let closed = false;
      while (i < n) {
        const c = input[i] as string;
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === "\\") {
          const next = input[i + 1] ?? "";
          if (next === "$" || next === "`" || next === '"' || next === "\\") {
            cur.value += next;
          } else if (next === "\n") {
            // 継続行
          } else {
            cur.value += c + next;
          }
          i += 2;
          continue;
        }
        if (c === "$" && input[i + 1] === "(") {
          const close = findClosingParen(input, i + 1);
          if (close < 0) {
            out.ok = false;
            return;
          }
          addSubstitution(input.slice(i + 2, close), input.slice(i, close + 1));
          i = close + 1;
          continue;
        }
        if (c === "`") {
          const close = input.indexOf("`", i + 1);
          if (close < 0) {
            out.ok = false;
            return;
          }
          addSubstitution(input.slice(i + 1, close), input.slice(i, close + 1));
          i = close + 1;
          continue;
        }
        if (c === "$" && /[A-Za-z_{0-9@*#?!-]/.test(input[i + 1] ?? "")) {
          cur.dynamic = true;
          if (input[i + 1] === "{") {
            const close = findClosingBrace(input, i + 1);
            if (close < 0) {
              out.ok = false;
              return;
            }
            cur.value += input.slice(i, close + 1);
            i = close + 1;
            continue;
          }
        }
        cur.value += c;
        i++;
      }
      if (!closed) {
        out.ok = false;
        return;
      }
      continue;
    }

    if (ch === "`") {
      const close = input.indexOf("`", i + 1);
      if (close < 0) {
        out.ok = false;
        return;
      }
      addSubstitution(input.slice(i + 1, close), input.slice(i, close + 1));
      i = close + 1;
      continue;
    }

    if (ch === "$") {
      const next = input[i + 1] ?? "";
      if (next === "(") {
        const close = findClosingParen(input, i + 1);
        if (close < 0) {
          out.ok = false;
          return;
        }
        addSubstitution(input.slice(i + 2, close), input.slice(i, close + 1));
        i = close + 1;
        continue;
      }
      if (next === "{") {
        const close = findClosingBrace(input, i + 1);
        if (close < 0) {
          out.ok = false;
          return;
        }
        cur.started = true;
        cur.dynamic = true;
        cur.value += input.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      if (next === "'") {
        const end = input.indexOf("'", i + 2);
        if (end < 0) {
          out.ok = false;
          return;
        }
        cur.started = true;
        cur.dynamic = true;
        cur.value += input.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (/[A-Za-z_0-9@*#?!-]/.test(next)) {
        cur.started = true;
        cur.dynamic = true;
        let j = i + 1;
        if (/[A-Za-z_]/.test(next)) {
          while (j < n && /[A-Za-z_0-9]/.test(input[j] as string)) j++;
        } else {
          j = i + 2;
        }
        cur.value += input.slice(i, j);
        i = j;
        continue;
      }
      cur.started = true;
      cur.value += "$";
      i++;
      continue;
    }

    if (ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")") {
      // `&>` と `>&` はリダイレクトとして扱う
      if (ch === "&" && input[i + 1] === ">") {
        endWord();
        let op = "&>";
        i += 2;
        if (input[i] === ">") {
          op = "&>>";
          i++;
        }
        pendingRedirect = { op };
        continue;
      }
      endCommand();
      i++;
      if ((ch === "&" || ch === "|") && input[i] === ch) i++;
      else if (ch === "|" && input[i] === "&") i++;
      else if (ch === ";" && input[i] === ";") i++;
      continue;
    }

    if (ch === ">" || ch === "<") {
      // 直前の語が数字だけなら、ファイル記述子の指定として捨てる
      if (cur.started && /^[0-9]+$/.test(cur.value) && !cur.dynamic) cur = newBuilder();
      else endWord();
      let op = ch;
      i++;
      if (ch === ">" && (input[i] === ">" || input[i] === "|" || input[i] === "&")) {
        op += input[i];
        i++;
      } else if (ch === "<" && input[i] === "<") {
        op += "<";
        i++;
        if (input[i] === "<") {
          op += "<";
          i++;
        } else if (input[i] === "-") {
          op += "-";
          i++;
        }
      } else if (ch === "<" && input[i] === "&") {
        op += "&";
        i++;
      }
      if (op === "<<" || op === "<<-") {
        // 区切り語を読む
        while (input[i] === " " || input[i] === "\t") i++;
        let delimiter = "";
        let quoted = false;
        while (i < n && !/[\s;&|()<>]/.test(input[i] as string)) {
          const c = input[i] as string;
          if (c === "'" || c === '"') {
            quoted = true;
            const end = input.indexOf(c, i + 1);
            if (end < 0) {
              out.ok = false;
              return;
            }
            delimiter += input.slice(i + 1, end);
            i = end + 1;
            continue;
          }
          if (c === "\\") {
            quoted = true;
            delimiter += input[i + 1] ?? "";
            i += 2;
            continue;
          }
          delimiter += c;
          i++;
        }
        heredocs.push({ delimiter, strip: op === "<<-", quoted });
        continue;
      }
      if (op === ">&" || op === "<&") {
        // `2>&1` のような複製。対象は読み取り・書き込みの先ではない
        while (input[i] === " " || input[i] === "\t") i++;
        while (i < n && /[0-9-]/.test(input[i] as string)) i++;
        continue;
      }
      pendingRedirect = { op };
      continue;
    }

    // 通常の文字
    cur.started = true;
    if (ch === "*" || ch === "?" || ch === "[") cur.glob = true;
    if (ch === "{" && /\{[^}]*[,.][^}]*\}/.test(input.slice(i))) cur.glob = true;
    cur.value += ch;
    i++;
  }
  if (heredocs.length > 0) out.ok = false;
  endCommand();
}

/** 先頭の予約語・代入を除いた、実際のコマンド名と引数 */
export interface Invocation {
  name: string;
  args: Word[];
  redirects: Redirect[];
  nested: boolean;
  afterCd: boolean;
  /** `xargs` などを経由した(引数が実行時に決まる) */
  viaXargs: boolean;
}

const WRAPPERS_WITH_OPTIONS: Record<string, { optionsWithValue: string[] }> = {
  env: { optionsWithValue: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"] },
  nice: { optionsWithValue: ["-n", "--adjustment"] },
  ionice: { optionsWithValue: ["-c", "-n", "-p"] },
  timeout: { optionsWithValue: ["-s", "--signal", "-k", "--kill-after"] },
  stdbuf: { optionsWithValue: ["-i", "-o", "-e"] },
};
const SIMPLE_WRAPPERS = new Set([
  "command",
  "builtin",
  "exec",
  "nohup",
  "time",
  "setsid",
  "unbuffer",
]);

function isAssignment(word: Word): boolean {
  return /^[A-Za-z_][A-Za-z_0-9]*=/.test(word.value) && !word.value.startsWith("=");
}

/** 1 つのコマンドから、ラッパー(env、nohup、time、xargs など)を外した呼び出しを求める */
export function toInvocation(cmd: SimpleCommand): Invocation | null {
  let words = cmd.words;
  let viaXargs = false;
  for (let guard = 0; guard < 12; guard++) {
    // 先頭の代入と予約語
    while (
      words.length > 0 &&
      (isAssignment(words[0] as Word) || RESERVED_SEPARATORS.has((words[0] as Word).value))
    ) {
      words = words.slice(1);
    }
    if (words.length === 0) return null;
    const first = words[0] as Word;
    const name = first.value;
    if (SIMPLE_WRAPPERS.has(name)) {
      words = words.slice(1);
      // `time -p`、`command -v` のようなオプションを読み飛ばす
      while (words.length > 0 && (words[0] as Word).value.startsWith("-")) words = words.slice(1);
      continue;
    }
    if (name === "xargs") {
      viaXargs = true;
      words = words.slice(1);
      while (words.length > 0 && (words[0] as Word).value.startsWith("-")) {
        const opt = (words[0] as Word).value;
        words = words.slice(["-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a"].includes(opt) ? 2 : 1);
      }
      continue;
    }
    const spec = WRAPPERS_WITH_OPTIONS[name];
    if (spec) {
      words = words.slice(1);
      while (words.length > 0) {
        const w = (words[0] as Word).value;
        if (w.startsWith("-") && w !== "-") {
          words = words.slice(spec.optionsWithValue.includes(w) ? 2 : 1);
        } else if (isAssignment(words[0] as Word)) {
          words = words.slice(1);
        } else if (name === "timeout" && /^[0-9.]+[smhd]?$/.test(w)) {
          words = words.slice(1);
          break;
        } else if (name === "nice" || name === "ionice") {
          break;
        } else {
          break;
        }
      }
      continue;
    }
    // パスつきの呼び出し(/usr/bin/rm)は、基本名で見る
    const base = name.includes("/") ? (name.split("/").pop() as string) : name;
    return {
      name: base,
      args: words.slice(1),
      redirects: cmd.redirects,
      nested: cmd.nested,
      afterCd: cmd.afterCd,
      viaXargs,
    };
  }
  return null;
}

export function invocations(parsed: ParseResult): Invocation[] {
  const out: Invocation[] = [];
  for (const cmd of parsed.commands) {
    const inv = toInvocation(cmd);
    if (inv) out.push(inv);
  }
  return out;
}

/** `bash -c '...'` と `eval` の中身を、入れ子のコマンドとして展開する */
function expandShellInvocations(parsed: ParseResult): void {
  const extra: SimpleCommand[] = [];
  for (const cmd of parsed.commands) {
    const inv = toInvocation(cmd);
    if (!inv) continue;
    if (inv.name === "eval") {
      parsed.opaque = true;
      const text = inv.args.map((w) => w.value).join(" ");
      if (inv.args.some((w) => w.dynamic)) continue;
      const inner = parseShell(text);
      for (const c of inner.commands) extra.push({ ...c, nested: true });
      if (!inner.ok) parsed.ok = false;
      continue;
    }
    if (SHELLS.has(inv.name)) {
      const idx = inv.args.findIndex((w) => /^-[A-Za-z]*c[A-Za-z]*$/.test(w.value));
      if (idx < 0) continue;
      const body = inv.args[idx + 1];
      if (!body) continue;
      if (body.dynamic) {
        parsed.opaque = true;
        continue;
      }
      const inner = parseShell(body.value);
      for (const c of inner.commands) extra.push({ ...c, nested: true });
      if (!inner.ok) parsed.ok = false;
      if (inner.opaque) parsed.opaque = true;
    }
  }
  parsed.commands.push(...extra);
}

function markAfterCd(parsed: ParseResult): void {
  let seenCd = false;
  for (const cmd of parsed.commands) {
    if (cmd.nested) {
      cmd.afterCd = seenCd;
      continue;
    }
    cmd.afterCd = seenCd;
    const inv = toInvocation(cmd);
    if (inv && CD_COMMANDS.has(inv.name)) seenCd = true;
  }
}

/** 語の値を、`~` と既知の環境変数だけ展開して返す。展開できない動的な語は null */
export function expandWord(word: Word, env: { home: string; tmpdir: string }): string | null {
  let value = word.value;
  if (word.dynamic) {
    // `$TMPDIR`、`${TMPDIR}`、`$HOME`、`${HOME}` だけは、先頭にある場合に限って許可する
    const m = /^\$(\{)?(TMPDIR|HOME)(\})?(\/.*)?$/.exec(value);
    if (!m || Boolean(m[1]) !== Boolean(m[3])) return null;
    const base = m[2] === "HOME" ? env.home : env.tmpdir;
    value = base + (m[4] ?? "");
    if (/[$`]/.test(value)) return null;
  }
  if (value === "~") return env.home;
  if (value.startsWith("~/")) return env.home + value.slice(1);
  if (value.startsWith("~")) return null; // ~user は判定できない
  return value;
}
