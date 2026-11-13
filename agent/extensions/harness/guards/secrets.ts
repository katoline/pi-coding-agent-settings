import path from "node:path";
import type { Invocation, ParseResult } from "../lib/shell.ts";
import type { GuardInput } from "../lib/types.ts";
import { ALLOW, block, combine, type Verdict } from "../lib/verdict.ts";
import { wordToAbsolute } from "./paths.ts";

const EXAMPLE_SUFFIX = /\.(example|sample|template|dist|defaults|schema)$/i;
const SECRET_BASENAMES = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|ppk)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.(npmrc|netrc|pgpass|git-credentials|pypirc|dockercfg)$/i,
  /^credentials(\.json)?$/i,
  /^service[-_]account.*\.json$/i,
  /^secrets?\.(ya?ml|json|toml|env)$/i,
  /\.tfvars$/i,
  /^auth\.json$/i,
];
const SECRET_PATH_PARTS = [
  /(^|\/)\.ssh\//,
  /(^|\/)\.gnupg\//,
  /(^|\/)\.aws\//,
  /(^|\/)\.config\/gh\/hosts\.yml$/,
  /(^|\/)\.config\/gcloud\//,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.kube\/config$/,
  /(^|\/)\.pi\/agent\/auth\.json$/,
  /^\/proc\/[^/]+\/environ$/,
];

/** 秘密情報を含みうるファイルか。`.env.example` などのテンプレートは除く */
export function isSecretPath(p: string): boolean {
  const normalized = p.split(path.sep).join("/");
  const base = path.posix.basename(normalized);
  if (EXAMPLE_SUFFIX.test(base)) return false;
  if (SECRET_PATH_PARTS.some((re) => re.test(normalized))) return true;
  return SECRET_BASENAMES.some((re) => re.test(base));
}

export function findSecretFiles(names: string[]): string[] {
  return names.filter((n) => isSecretPath(n));
}

const SECRET_MESSAGE =
  "秘密情報(.env、秘密鍵、トークン、API キーなど)の読み取り・出力・変更は禁止です。設定の例は `.env.example` のようなテンプレートを使ってください。";

/** read / write / edit / grep / find / ls ツールのパス引数 */
export function checkSecretToolPath(rawPath: string, input: GuardInput): Verdict {
  const abs = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(input.env.cwd, rawPath.replace(/^~(?=\/|$)/, input.env.home));
  return isSecretPath(input.fs.resolve(abs)) ? block(SECRET_MESSAGE) : ALLOW;
}

const SECRET_VAR = /\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z_]*/i;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
const READ_LIKE = new Set([
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "bat",
  "nl",
  "tac",
  "strings",
  "xxd",
  "od",
  "hexdump",
  "base64",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "awk",
  "sed",
  "cut",
  "sort",
  "uniq",
  "diff",
  "cmp",
  "cp",
  "mv",
  "scp",
  "rsync",
  "tar",
  "zip",
  "source",
  ".",
  "ln",
  "vi",
  "vim",
  "nano",
  "code",
  "xargs",
  "jq",
  "yq",
  "wc",
  "file",
  "stat",
  "open",
  "curl",
  "wget",
]);

/** glob が展開されうる名前の候補(`.env*` なら `.env`、`.env.x`)。秘密のファイル名を狙っているかの判定に使う */
function globCandidates(pattern: string): string[] {
  return [
    pattern.replace(/[*?]/g, ""),
    pattern.replace(/\*/g, ".x").replace(/\?/g, "x"),
    pattern.replace(/\*/g, "x").replace(/\?/g, "x"),
  ];
}

export function checkSecretsBash(inv: Invocation, input: GuardInput): Verdict {
  const verdicts: Verdict[] = [];
  for (const r of inv.redirects) {
    const t = wordToAbsolute(r.target, input);
    if (t && isSecretPath(input.fs.resolve(t.abs))) verdicts.push(block(SECRET_MESSAGE));
  }
  if (READ_LIKE.has(inv.name) || inv.name === "git") {
    for (const w of inv.args) {
      if (w.value.startsWith("-") && !w.value.includes("=")) continue;
      const raw =
        w.value.includes("=") && w.value.startsWith("-") ? (w.value.split("=")[1] ?? "") : w.value;
      if (!raw) continue;
      const t = wordToAbsolute({ ...w, value: raw }, input);
      if (t && isSecretPath(input.fs.resolve(t.abs))) {
        verdicts.push(block(SECRET_MESSAGE));
        break;
      }
      // glob(`cat .env*`)は、glob の手前までしか分からない。パターン自体が秘密のファイル名を狙っていれば拒否
      if (w.glob && globCandidates(raw).some((c) => isSecretPath(c))) {
        verdicts.push(block(SECRET_MESSAGE));
        break;
      }
    }
  }
  if (inv.name === "printenv") {
    const named = inv.args.filter((w) => !w.value.startsWith("-"));
    if (named.length === 0 || named.some((w) => SECRET_NAME.test(w.value))) {
      verdicts.push(block("環境変数の一覧や、秘密の値の出力は禁止です。"));
    }
  }
  if (
    (inv.name === "echo" || inv.name === "printf") &&
    inv.args.some((w) => SECRET_VAR.test(w.value))
  ) {
    verdicts.push(block("秘密の値を持つ環境変数の出力は禁止です。"));
  }
  return combine(verdicts);
}

/** コマンドの先頭が、引数なしの `env` / `export -p` / `declare -p` / `set` で環境変数を一覧する */
export function checkEnvDump(parsed: ParseResult): Verdict {
  for (const cmd of parsed.commands) {
    const words = cmd.words.filter((w) => !/^[A-Za-z_][A-Za-z_0-9]*=/.test(w.value));
    const first = words[0]?.value;
    if (!first) continue;
    const rest = words.slice(1).map((w) => w.value);
    const dumps =
      (first === "env" && rest.every((r) => r.startsWith("-"))) ||
      (first === "export" && rest.includes("-p")) ||
      (first === "declare" && rest.includes("-p")) ||
      (first === "typeset" && rest.includes("-p")) ||
      (first === "set" && rest.length === 0) ||
      (first === "compgen" && rest.includes("-e"));
    if (dumps) return block("環境変数の一覧の出力は禁止です(トークンや API キーが含まれます)。");
  }
  return ALLOW;
}

// ---- 出力の秘匿(tool_result) ----
const MASK = "[秘匿]";
const REDACTIONS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, MASK],
  [/\bsk-[A-Za-z0-9]{32,}/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, MASK],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, `$1${MASK}`],
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${MASK}@`],
  [
    /\b([A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|passw(?:or)?d|credential)[A-Za-z0-9_-]*)(\s*[=:]\s*)(["']?)[^\s"']{8,}\3/gi,
    `$1$2${MASK}`,
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
  return out;
}
