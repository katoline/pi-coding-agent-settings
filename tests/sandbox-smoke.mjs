import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

mkdirSync("/tmp/pi-agent/sessions", { recursive: true });
writeFileSync("/tmp/pi-agent/sessions/probe", "session storage works");
writeFileSync("/work/allowed", "ok");
assert.equal(readFileSync("/work/allowed", "utf8"), "ok");
rmSync("/work/allowed");
for (const filename of [
  "/etc/pi-harness-probe",
  "/work/.git/pi-harness-probe",
  "/opt/harness/pi-harness-probe",
]) {
  assert.throws(() => writeFileSync(filename, "must fail"));
}
const child = spawnSync(
  "node",
  ["-e", "require('node:fs').writeFileSync('/etc/pi-child-probe','must fail')"],
  { encoding: "utf8" },
);
assert.notEqual(child.status, 0);
console.log(
  "Sandbox smoke passed: project writes allowed; root, trusted harness, Git metadata and child writes denied.",
);
