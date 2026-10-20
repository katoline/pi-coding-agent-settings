import { spawnSync } from "node:child_process";

for (const [command, args] of [
  ["npm", ["ci", "--ignore-scripts", "--cache", "/tmp/npm-cache"]],
  ["pi", process.argv.slice(2)],
]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
