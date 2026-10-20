import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory()
      ? collect(name)
      : /\.test\.(?:mjs|js|ts)$/.test(name)
        ? [name]
        : [];
  });
}
const tests = collect("tests");
if (!tests.length)
  throw new Error(
    "No tests found. Add real project regression tests before publishing.",
  );
const result = spawnSync(process.execPath, ["--test", ...tests], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status || (result.signal ? 1 : 0));
