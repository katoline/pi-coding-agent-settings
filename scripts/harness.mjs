import { readFileSync } from "node:fs";
import path from "node:path";
import {
  config,
  HOME,
  IMAGE,
  project,
  requireBranch,
  run,
  sandboxArgs,
} from "./lib.mjs";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(
    "Usage: node scripts/harness.mjs build | run [project-directory] [task]\nRequires Docker and a provider-only PI_HARNESS_AUTH_FILE. Git operations run separately through git-guard.mjs.",
  );
} else if (args[0] === "build") {
  run("docker", ["build", "--tag", IMAGE, HOME], { stdio: "inherit" });
} else if (args[0] === "run") {
  run("pi", ["--version"]);
  const root = project(args[1]);
  if (root === HOME)
    throw new Error(
      "Keep the trusted harness checkout separate from the project being edited",
    );
  run("git", ["-C", root, "check-ignore", ".harness/publish.json"]);
  requireBranch(root);
  const cfg = config();
  const model = cfg.models.worker ? ["--model", cfg.models.worker] : [];
  const prompt = readFileSync(
    path.join(HOME, ".pi/prompts/implement.md"),
    "utf8",
  );
  run(
    "docker",
    [
      ...sandboxArgs(root, { auth: true }),
      ...(process.stdin.isTTY && !args[2] ? ["-it"] : ["-i"]),
      "--tmpfs",
      `/work/node_modules:rw,nosuid,nodev,size=2g,uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000}`,
      "--entrypoint",
      "node",
      IMAGE,
      "/opt/harness/scripts/container-start.mjs",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--skill",
      "/opt/harness/.pi/skills/new-project",
      "-e",
      "/opt/harness/.pi/extensions/harness.ts",
      "--tools",
      "read,grep,find,ls,write,edit,harness_delegate,harness_check",
      "--append-system-prompt",
      prompt,
      ...model,
      ...(args[2] ? ["-p", args.slice(2).join(" ")] : []),
    ],
    { stdio: "inherit", timeout: cfg.timeoutSeconds * 1000 },
  );
} else {
  throw new Error("Unknown command");
}
