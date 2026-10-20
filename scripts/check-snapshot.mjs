import { config, run } from "./lib.mjs";

// Runs ONLY in the container, against a disposable staged/HEAD snapshot.
if (process.cwd() !== "/work")
  throw new Error("Run this in the verification container");
run("npm", ["ci", "--ignore-scripts", "--cache", "/tmp/npm-cache"], {
  stdio: "inherit",
});
for (const [command, ...args] of config().checks)
  run(command, args, { stdio: "inherit" });
