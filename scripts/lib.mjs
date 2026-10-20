import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const HOME =
  process.env.PI_HARNESS_HOME ||
  realpathSync(fileURLToPath(new URL("..", import.meta.url)));
export const IMAGE = "pi-harness:1.3.0";
export function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr || result.stdout || "see output"}`,
    );
  return (result.stdout || "").trim();
}
export function git(root, ...args) {
  return run("git", ["-C", root, ...args]);
}
export function project(dir = process.cwd()) {
  return realpathSync(git(realpathSync(dir), "rev-parse", "--show-toplevel"));
}
export function config() {
  return JSON.parse(
    readFileSync(path.join(HOME, "harness.config.json"), "utf8"),
  );
}
export function requireBranch(root, cfg = config()) {
  const branch = git(root, "symbolic-ref", "--short", "HEAD");
  if (cfg.protectedBranches.includes(branch) || branch === cfg.baseBranch)
    throw new Error(`Protected branch: ${branch}`);
  if (!branch.startsWith("agent/"))
    throw new Error("Use an agent/* feature branch");
  return branch;
}
export function assertInside(root, filename) {
  const relative = path.relative(root, filename);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export function sandboxArgs(root, { gitReadonly = true, auth = false } = {}) {
  if (assertInside(root, HOME) || assertInside(HOME, root))
    throw new Error("Trusted harness and target project must not overlap");
  const args = [
    "run",
    "--rm",
    "--init",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=256",
    "--memory=4g",
    "--cpus=2",
    "--user",
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=1g",
    "--tmpfs",
    `/tmp/pi-agent:rw,nosuid,nodev,size=64m,uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000},mode=0700`,
    "-e",
    "HOME=/tmp/home",
    "-e",
    "PI_CODING_AGENT_DIR=/tmp/pi-agent",
    "-e",
    "PI_OFFLINE=1",
    "-e",
    "PI_TELEMETRY=0",
    "--mount",
    `type=bind,src=${root},dst=/work`,
    "--mount",
    `type=bind,src=${HOME},dst=/opt/harness,readonly`,
    "--workdir",
    "/work",
  ];
  if (gitReadonly) {
    const metadata = realpathSync(path.join(root, ".git"));
    if (metadata !== path.join(root, ".git"))
      throw new Error("Linked worktrees are unsupported by this launcher");
    args.push("--mount", `type=bind,src=${metadata},dst=/work/.git,readonly`);
  }
  if (auth) {
    const filename = process.env.PI_HARNESS_AUTH_FILE;
    if (!filename)
      throw new Error(
        "Set PI_HARNESS_AUTH_FILE to your Pi provider-only auth.json (never a GitHub credential)",
      );
    args.push(
      "--mount",
      `type=bind,src=${realpathSync(filename)},dst=/tmp/pi-agent/auth.json,readonly`,
    );
  }
  return args;
}
