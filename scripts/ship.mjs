import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, git, HOME, project, requireBranch, run } from "./lib.mjs";
import { mergeBody } from "./pr-body.mjs";

// This command is the explicit authorization boundary for commit, push and PR creation.
const [directory, ...task] = process.argv.slice(2);
if (!directory || !task.length) {
  console.log(
    "Usage: node scripts/ship.mjs /path/to/project TASK\nStarts from a clean agent/* branch; automatically implements, checks, reviews, commits, pushes and creates/updates a PR.",
  );
} else {
  const root = project(directory);
  requireBranch(root);
  if (git(root, "status", "--porcelain"))
    throw new Error(
      "Start with a clean project so unrelated user changes cannot be staged",
    );
  const planFile = path.join(root, ".harness", "publish.json");
  if (existsSync(planFile))
    throw new Error(
      "Archive the previous .harness/publish.json before starting a new shipping task",
    );
  const instruction = `${task.join(" ")}\nAfter successful checks and independent review, write .harness/publish.json with exactly {"commits":[{"message":"...","paths":["relative/path"]}],"title":"...","body":"final PR description with validation"}. Group cohesive independently passing commits; list every changed nonignored file exactly once. Do not perform Git writes. Each intermediate commit must pass all checks. The host will stop at the first failing check or review.`;
  run(
    process.execPath,
    [path.join(HOME, "scripts/harness.mjs"), "run", root, instruction],
    { stdio: "inherit" },
  );
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  if (
    !Array.isArray(plan.commits) ||
    !plan.commits.length ||
    typeof plan.title !== "string" ||
    !plan.title.trim() ||
    typeof plan.body !== "string" ||
    !plan.body.trim()
  )
    throw new Error("Invalid publication plan");
  const changed = new Set(
    [
      ...git(root, "diff", "--name-only", "-z").split("\0"),
      ...git(root, "ls-files", "--others", "--exclude-standard", "-z").split(
        "\0",
      ),
    ].filter(Boolean),
  );
  const planned = new Set();
  for (const commit of plan.commits) {
    if (
      typeof commit.message !== "string" ||
      !commit.message.trim() ||
      !Array.isArray(commit.paths) ||
      !commit.paths.length
    )
      throw new Error("Invalid commit plan");
    for (const name of commit.paths) {
      if (
        typeof name !== "string" ||
        name.startsWith("-") ||
        path.isAbsolute(name) ||
        name.split("/").some((p) => p === ".git" || p === "..") ||
        !changed.has(name) ||
        planned.has(name)
      )
        throw new Error(`Invalid or duplicate changed path: ${name}`);
      planned.add(name);
    }
  }
  if (planned.size !== changed.size)
    throw new Error("Commit plan does not cover the entire change");
  const gate = fileURLToPath(new URL("./git-guard.mjs", import.meta.url));
  for (const commit of plan.commits) {
    git(root, "add", "--", ...commit.paths);
    run(process.execPath, [gate, "commit", commit.message], {
      cwd: root,
      stdio: "inherit",
    });
  }
  run(process.execPath, [gate, "push"], { cwd: root, stdio: "inherit" });
  const sha = git(root, "rev-parse", "HEAD");
  // A missing workflow is a configuration error, not a reason to silently skip CI.
  const deadline = Date.now() + config().timeoutSeconds * 1000;
  let succeeded = false;
  while (Date.now() < deadline) {
    const runs = JSON.parse(
      run(
        "gh",
        [
          "run",
          "list",
          "--commit",
          sha,
          "--event",
          "push",
          "--workflow",
          "Quality",
          "--json",
          "databaseId,status,conclusion",
        ],
        { cwd: root },
      ),
    );
    if (runs.length) {
      run("gh", ["run", "watch", String(runs[0].databaseId), "--exit-status"], {
        cwd: root,
        stdio: "inherit",
        timeout: Math.max(1, deadline - Date.now()),
      });
      succeeded = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!succeeded)
    throw new Error(
      "Timed out waiting for the push Quality workflow; branch was pushed, PR was not created",
    );
  const { writeFileSync } = await import("node:fs");
  const bodyFile = path.join(root, ".harness", "pr-body.md");
  writeFileSync(bodyFile, plan.body);
  const existing = JSON.parse(
    run(
      "gh",
      [
        "pr",
        "list",
        "--head",
        requireBranch(root),
        "--state",
        "open",
        "--json",
        "number,body",
      ],
      { cwd: root },
    ),
  );
  if (existing.length > 1)
    throw new Error("Multiple PRs for this branch; resolve manually");
  writeFileSync(bodyFile, mergeBody(existing[0]?.body || "", plan.body));
  run(
    process.execPath,
    [gate, existing.length ? "pr-update" : "pr", plan.title, bodyFile],
    { cwd: root, stdio: "inherit" },
  );
}
