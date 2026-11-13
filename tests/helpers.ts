import type { HarnessConfig } from "../agent/extensions/harness/lib/config.ts";
import { invocations, parseShell } from "../agent/extensions/harness/lib/shell.ts";
import type { GuardInput } from "../agent/extensions/harness/lib/types.ts";

export const HOME = "/home/u";

export const config: HarnessConfig = {
  workRoots: [
    `${HOME}/Dev/kaishi`,
    `${HOME}/Dev/seino914`,
    `${HOME}/Dev/hobby`,
    `${HOME}/orca/workspaces`,
  ],
  tempRoots: ["$TMPDIR", "/tmp/claude-*"],
  protectedGlobalPaths: [`${HOME}/Dev/kaishi/ubuntu-dotfiles`],
  protectedHarnessPaths: [`${HOME}/.pi/agent`],
  defaultBranches: ["main", "master"],
  dropContextFiles: false,
  selectModelOnStartup: true,
  subagent: { maxTasks: 8, maxConcurrency: 4, timeoutSeconds: 900, maxTotal: 64 },
};

export function input(over: {
  subagent?: boolean;
  cwd?: string;
  branch?: string | null;
  inRepo?: boolean;
  merged?: string[];
  owned?: string[];
}): GuardInput {
  return {
    env: {
      isSubagent: over.subagent ?? false,
      cwd: over.cwd ?? `${HOME}/Dev/seino914/app`,
      home: HOME,
      tmpdir: "/tmp",
    },
    config,
    git: {
      inRepo: over.inRepo ?? true,
      repoRoot: over.inRepo === false ? null : (over.cwd ?? `${HOME}/Dev/seino914/app`),
      currentBranch: over.branch === undefined ? "feat/x" : over.branch,
      defaultBranches: new Set(["main", "master"]),
      mergedRemoteBranches: new Set(over.merged ?? []),
      ownedWorktrees: new Set(over.owned ?? []),
    },
    fs: { resolve: (p: string) => p },
  };
}

export const inv = (cmd: string) => {
  const found = invocations(parseShell(cmd));
  if (found.length === 0) throw new Error(`解析できません: ${cmd}`);
  return found;
};
