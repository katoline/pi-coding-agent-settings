import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOME } from "./lib.mjs";

const destination = process.argv[2];
if (!destination || destination === "--help") {
  console.log("Usage: node scripts/init-project.mjs /path/to/empty-project");
} else {
  const root = path.resolve(destination);
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).some((name) => name !== ".git"))
    throw new Error("Destination must be empty; no files were overwritten");
  if (
    spawnSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      stdio: "ignore",
    }).status === 0
  )
    throw new Error("Existing committed repository is not an empty project");
  for (const directory of ["scripts", "tests", "src", ".github/workflows"])
    mkdirSync(path.join(root, directory), { recursive: true });
  for (const name of [
    "flake.nix",
    "flake.lock",
    ".envrc",
    "biome.json",
    ".github/workflows/quality.yml",
    ".github/pull_request_template.md",
  ])
    copyFileSync(path.join(HOME, name), path.join(root, name));
  const workflow = (await import("node:fs"))
    .readFileSync(path.join(HOME, ".github/workflows/quality.yml"), "utf8")
    .split("\n  sandbox:")[0];
  writeFileSync(path.join(root, ".github/workflows/quality.yml"), workflow);
  copyFileSync(
    path.join(HOME, "templates/project.package.json"),
    path.join(root, "package.json"),
  );
  copyFileSync(
    path.join(HOME, "templates/require-tests.mjs"),
    path.join(root, "scripts/require-tests.mjs"),
  );
  writeFileSync(
    path.join(root, ".gitignore"),
    "node_modules/\n.harness/\n.direnv/\nresult\n.env\n.env.*\n",
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          allowJs: true,
          checkJs: true,
          types: ["node"],
        },
        include: ["src/**/*", "tests/**/*"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(root, "AGENTS.md"),
    "# Project requirements\n\nRecord actual acceptance conditions, architecture and compatibility constraints here. Use the trusted Pi harness for checks/reviews and host git-guard for publication. Never directly push protected branches or bypass checks.\n",
  );
  console.log(
    "Nix/Biome/CI template created. Add actual source and meaningful tests, then generate package-lock.json and run npm run check. GitHub rulesets still require configuration.",
  );
}
