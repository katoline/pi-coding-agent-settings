import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { assertCi } from "../scripts/git-guard.mjs";
import {
  assertInside,
  HOME,
  requireBranch,
  run,
  sandboxArgs,
} from "../scripts/lib.mjs";

process.env.PI_HARNESS_HOME = HOME;
const { default: extension } = await import("../.pi/extensions/harness.ts");

const tmp = mkdtempSync(path.join(os.tmpdir(), "pi-policy-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
function repo(name, branch) {
  const root = path.join(tmp, name);
  mkdirSync(root);
  run("git", ["init", "-q", "-b", branch, root]);
  return root;
}
test("protected branches and non-agent branches fail closed", () => {
  for (const branch of ["main", "master", "feature/test"]) {
    assert.throws(() =>
      requireBranch(repo(branch.replaceAll("/", "-"), branch)),
    );
  }
  assert.equal(requireBranch(repo("allowed", "agent/test")), "agent/test");
});
test("CI requires the exact SHA, push event, latest success and expected workflow", () => {
  const pass = {
    headSha: "abc",
    workflowName: "Quality",
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  assert.doesNotThrow(() => assertCi([pass], "abc"));
  for (const field of [
    { headSha: "old" },
    { event: "pull_request" },
    { workflowName: "Other" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
  ])
    assert.throws(() => assertCi([{ ...pass, ...field }], "abc"));
  assert.throws(() => assertCi([], "abc"));
  assert.throws(() =>
    assertCi([{ ...pass, conclusion: "failure" }, pass], "abc"),
  );
});
test("path containment rejects sibling prefix and parent traversal", () => {
  assert.equal(assertInside("/work", "/work/src/a"), true);
  assert.equal(assertInside("/work", "/work-other/a"), false);
  assert.equal(assertInside("/work", "/etc/passwd"), false);
});
test("sandbox is non-root, read-only, no privileges, with protected Git metadata", () => {
  const root = repo("sandbox", "agent/test");
  const args = sandboxArgs(root);
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop=ALL"));
  assert.ok(args.includes("--security-opt=no-new-privileges"));
  assert.ok(
    args.includes(`type=bind,src=${root}/.git,dst=/work/.git,readonly`),
  );
  assert.ok(!args.join(" ").includes("docker.sock"));
  assert.ok(!args.join(" ").includes(".ssh"));
});
const handlers = new Map();
const tools = new Map();
extension({
  on: (name, handler) => handlers.set(name, handler),
  registerTool: (tool) => tools.set(tool.name, tool),
});
const gate = handlers.get("tool_call");
const root = repo("extension", "agent/test");
const ctx = { cwd: root };
test("raw shell and unknown tools are blocked", () => {
  for (const name of ["bash", "powershell", "mcp__git__push", "delete_file"])
    assert.equal(gate({ toolName: name, input: {} }, ctx).block, true);
});
test("writes outside project, through symlink and into Git metadata are blocked", () => {
  symlinkSync(tmp, path.join(root, "escape"));
  for (const filename of [
    "../victim",
    "/etc/passwd",
    ".git/config",
    "escape/victim",
  ]) {
    assert.equal(
      gate({ toolName: "write", input: { path: filename } }, ctx).block,
      true,
    );
  }
  assert.equal(
    gate({ toolName: "write", input: { path: "src/new.ts" } }, ctx),
    undefined,
  );
});
test("reviewer cannot write, execute checks or delegate", () => {
  process.env.PI_HARNESS_ROLE = "reviewer";
  try {
    for (const name of ["write", "edit", "harness_delegate", "harness_check"])
      assert.equal(
        gate({ toolName: name, input: { path: "a" } }, ctx).block,
        true,
      );
    assert.equal(
      gate({ toolName: "read", input: { path: "a" } }, ctx),
      undefined,
    );
  } finally {
    delete process.env.PI_HARNESS_ROLE;
  }
});

test("managed PR updates preserve human text and reject ambiguous markers", async () => {
  const { mergeBody } = await import("../scripts/pr-body.mjs");
  const first = mergeBody("Human notes", "Old generated content");
  const updated = mergeBody(
    `${first}\nReviewer notes`,
    "New generated content",
  );
  assert.ok(updated.startsWith("Human notes"));
  assert.ok(updated.endsWith("Reviewer notes"));
  assert.ok(updated.includes("New generated content"));
  assert.ok(!updated.includes("Old generated content"));
  assert.throws(() => mergeBody("<!-- pi-harness:start -->broken", "new"));
});

test("new-project scaffolding preserves existing files and rejects zero tests", () => {
  const root = path.join(tmp, "new-project");
  run(process.execPath, [path.join(HOME, "scripts/init-project.mjs"), root]);
  assert.throws(
    () =>
      run(process.execPath, [path.join(root, "scripts/require-tests.mjs")], {
        cwd: root,
      }),
    /No tests found/,
  );
  assert.throws(
    () =>
      run(process.execPath, [
        path.join(HOME, "scripts/init-project.mjs"),
        root,
      ]),
    /Destination must be empty/,
  );
});

test("trusted harness cannot overlap the writable project", () => {
  assert.throws(() => sandboxArgs(HOME), /must not overlap/);
  assert.throws(() => sandboxArgs(path.dirname(HOME)), /must not overlap/);
  assert.throws(
    () => sandboxArgs(path.join(HOME, "child-project")),
    /must not overlap/,
  );
});
