import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { IMAGE, run, sandboxArgs } from "./lib.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "pi-sandbox-smoke-"));
try {
  run("git", ["init", "-q", root]);
  run(
    "docker",
    [
      ...sandboxArgs(root),
      "--entrypoint",
      "node",
      IMAGE,
      "/opt/harness/tests/sandbox-smoke.mjs",
    ],
    { stdio: "inherit" },
  );
  console.log(run("docker", [...sandboxArgs(root), IMAGE, "--version"]));
} finally {
  rmSync(root, { recursive: true, force: true });
}
