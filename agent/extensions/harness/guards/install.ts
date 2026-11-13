import type { Invocation, ParseResult } from "../lib/shell.ts";
import type { GuardInput } from "../lib/types.ts";
import { ALLOW, ask, block, combine, type Verdict } from "../lib/verdict.ts";
import { isInsideOrEqual, wordToAbsolute } from "./paths.ts";

const ROOT_ESCALATION = new Set(["sudo", "doas", "su", "pkexec", "run0"]);
const SYSTEM_PACKAGE_MANAGERS = new Set([
  "apt",
  "apt-get",
  "aptitude",
  "snap",
  "flatpak",
  "dnf",
  "yum",
  "zypper",
  "pacman",
]);
const JS_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const JS_INSTALL_VERBS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "un",
  "update",
  "upgrade",
  "link",
  "ln",
  "unlink",
]);
const NIX_PROFILE_VERBS = new Set([
  "install",
  "add",
  "remove",
  "upgrade",
  "rollback",
  "wipe-history",
]);

const permanent = (what: string) =>
  `${what} は、プロジェクトの外に恒久的な影響が出ます。ユーザーの明示的な許可が必要です。`;

export function checkInstall(inv: Invocation): Verdict {
  const name = inv.name;
  const words = inv.args.map((w) => w.value);
  const has = (...f: string[]) => f.some((x) => words.includes(x));
  const firstVerb = words.find((w) => !w.startsWith("-"));

  if (ROOT_ESCALATION.has(name)) {
    return block(
      `\`${name}\` は実行できません。管理者権限が必要な場合は、実行してほしいコマンドをユーザーに示して、依頼してください。`,
    );
  }
  if (SYSTEM_PACKAGE_MANAGERS.has(name)) {
    const readOnly = [
      "list",
      "search",
      "show",
      "info",
      "policy",
      "depends",
      "rdepends",
      "download",
      "update",
    ].includes(firstVerb ?? "");
    return readOnly ? ALLOW : ask(permanent(`\`${name} ${firstVerb ?? ""}\``));
  }
  if (name === "dpkg") {
    return has("-i", "--install", "-r", "--remove", "-P", "--purge")
      ? ask(permanent("`dpkg`"))
      : ALLOW;
  }
  if (JS_MANAGERS.has(name)) {
    const verb = name === "yarn" && firstVerb === "global" ? "global" : firstVerb;
    const global = has("-g", "--global", "--location=global") || verb === "global";
    if (global && (verb === "global" || JS_INSTALL_VERBS.has(verb ?? ""))) {
      return ask(permanent(`\`${name} ${verb} -g\`(グローバルへのインストール)`));
    }
    if (verb === "link" || verb === "ln") return ask(permanent(`\`${name} link\``));
    return ALLOW;
  }
  if (name === "corepack" && (firstVerb === "enable" || firstVerb === "install")) {
    return ask(permanent("`corepack enable`"));
  }
  if (name === "pip" || name === "pip3" || name === "python" || name === "python3") {
    const isPip = name.startsWith("pip") || (words[0] === "-m" && words[1] === "pip");
    if (isPip && has("install") && has("--user", "--break-system-packages")) {
      return ask(permanent("`pip install --user`"));
    }
    return ALLOW;
  }
  if (
    name === "pipx" &&
    firstVerb &&
    ["install", "inject", "upgrade", "upgrade-all", "uninstall"].includes(firstVerb)
  ) {
    return ask(permanent("`pipx install`"));
  }
  if (name === "uv") {
    if (firstVerb === "tool" && has("install", "upgrade", "uninstall"))
      return ask(permanent("`uv tool install`"));
    if (firstVerb === "pip" && has("--system", "--break-system-packages"))
      return ask(permanent("`uv pip install --system`"));
    return ALLOW;
  }
  if (["cargo", "go", "gem"].includes(name) && firstVerb === "install")
    return ask(permanent(`\`${name} install\``));
  if (
    name === "brew" &&
    firstVerb &&
    ["install", "upgrade", "uninstall", "reinstall", "tap", "untap"].includes(firstVerb)
  ) {
    return ask(permanent("`brew`"));
  }
  if (name === "nix" && firstVerb === "profile" && words.some((w) => NIX_PROFILE_VERBS.has(w))) {
    return ask(permanent("`nix profile`"));
  }
  if (
    name === "nix-env" &&
    words.some(
      (w) =>
        /^-[A-Za-z]*[ieu]/.test(w) ||
        [
          "--install",
          "--uninstall",
          "--upgrade",
          "--set",
          "--rollback",
          "--switch-generation",
        ].includes(w),
    )
  ) {
    return ask(permanent("`nix-env`"));
  }
  if (
    name === "nix-channel" &&
    words.some((w) => ["--add", "--remove", "--update", "--rollback"].includes(w))
  ) {
    return ask(permanent("`nix-channel`"));
  }
  if (
    name === "home-manager" &&
    firstVerb &&
    ["switch", "uninstall", "expire-generations", "remove-generations"].includes(firstVerb)
  ) {
    return ask(
      "`home-manager switch` は、グローバル環境(home-manager)を変更します。ユーザーの明示的な許可が必要です。",
    );
  }
  if (name === "nixos-rebuild")
    return ask("`nixos-rebuild` はシステム全体を変更します。ユーザーの明示的な許可が必要です。");
  return ALLOW;
}

/** コマンド全体を見る検査(`curl ... | sh` のように、コマンドの組み合わせで判断するもの) */
export function checkInstallAll(parsed: ParseResult, invs: Invocation[]): Verdict {
  const fetches = invs.some((i) => i.name === "curl" || i.name === "wget" || i.name === "fetch");
  const runsStdin = invs.some(
    (i) =>
      ["sh", "bash", "zsh", "dash", "ksh", "python", "python3", "node", "perl", "ruby"].includes(
        i.name,
      ) &&
      !i.args.some((w) => /^-[A-Za-z]*c$/.test(w.value) || w.value === "-e" || w.value === "-c") &&
      i.args.filter((w) => !w.value.startsWith("-")).length === 0,
  );
  if (fetches && runsStdin) {
    return ask(
      "ネットワークから取得したスクリプトを、そのまま実行しようとしています(`curl ... | sh`)。内容を確認できないため、ユーザーの明示的な許可が必要です。",
    );
  }
  if (parsed.opaque && invs.some((i) => ["apt", "apt-get", "snap", "sudo"].includes(i.name))) {
    return block("中身を判定できない形で、パッケージの導入や権限の昇格を行わないでください。");
  }
  return ALLOW;
}

const MUTATORS = new Set([
  "rm",
  "mv",
  "cp",
  "tee",
  "ln",
  "touch",
  "mkdir",
  "chmod",
  "chown",
  "install",
  "truncate",
  "dd",
  "rsync",
  "sed",
  "perl",
  "git",
  "npm",
]);

/**
 * 開発中に変更させない場所(グローバル環境、ハーネス自身と認証情報)への書き込み。
 * cwd がその場所の内側にあるとき(その場所自体を開発しているとき)は許す。
 */
export function checkProtectedWrite(abs: string, input: GuardInput): Verdict {
  const resolved = input.fs.resolve(abs);
  for (const protectedPath of input.config.protectedGlobalPaths) {
    const root = input.fs.resolve(protectedPath);
    if (
      isInsideOrEqual(resolved, root) &&
      !isInsideOrEqual(input.fs.resolve(input.env.cwd), root)
    ) {
      return ask(
        `${protectedPath} はグローバル環境です。開発中に変更しません。変更が必要な場合は、ユーザーの明示的な許可が必要です。`,
      );
    }
  }
  for (const protectedPath of input.config.protectedHarnessPaths) {
    const root = input.fs.resolve(protectedPath);
    if (
      isInsideOrEqual(resolved, root) &&
      !isInsideOrEqual(input.fs.resolve(input.env.cwd), root)
    ) {
      return ask(
        `${protectedPath} は Pi のハーネスと認証情報の置き場所です。設定を変更するときは、設定リポジトリのほうを編集してください。`,
      );
    }
  }
  return ALLOW;
}

/** bash の、保護された場所への書き込み(リダイレクト先と、書き込み系コマンドの引数) */
export function checkProtectedBash(inv: Invocation, input: GuardInput): Verdict {
  const verdicts: Verdict[] = [];
  for (const r of inv.redirects) {
    if (r.op.startsWith("<")) continue;
    const t = wordToAbsolute(r.target, input);
    if (t) verdicts.push(checkProtectedWrite(t.abs, input));
  }
  if (MUTATORS.has(inv.name)) {
    for (const w of inv.args) {
      if (w.value.startsWith("-")) continue;
      const t = wordToAbsolute(w, input);
      if (t?.abs.startsWith("/")) verdicts.push(checkProtectedWrite(t.abs, input));
    }
  }
  return combine(verdicts);
}
