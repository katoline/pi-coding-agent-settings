import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGh, checkGit } from "../agent/extensions/harness/guards/git.ts";
import { combine, type Verdict } from "../agent/extensions/harness/lib/verdict.ts";
import { input, inv } from "./helpers.ts";

type Over = Parameters<typeof input>[0];

function git(cmd: string, over: Over = {}): Verdict {
  return combine(
    inv(cmd)
      .filter((i) => i.name === "git")
      .map((i) => checkGit(i, input(over))),
  );
}
function gh(cmd: string, over: Over = {}): Verdict {
  return combine(
    inv(cmd)
      .filter((i) => i.name === "gh")
      .map((i) => checkGh(i, input(over))),
  );
}
const kind = (v: Verdict) => v.kind;

test("既定ブランチ上の commit は拒否、作業ブランチ上は許可", () => {
  assert.equal(kind(git('git commit -m "x"', { branch: "main" })), "block");
  assert.equal(kind(git('git commit -m "x"', { branch: "master" })), "block");
  assert.equal(kind(git('git commit -m "x"', { branch: "feat/a" })), "allow");
});

test("commit の --no-verify と -n は拒否", () => {
  assert.equal(kind(git('git commit --no-verify -m "x"')), "block");
  assert.equal(kind(git('git commit -n -m "x"')), "block");
  assert.equal(kind(git('git commit -nm "x"')), "block");
  assert.equal(kind(git('git commit -am "fix -n handling"')), "allow");
});

test("commit --amend は許可制", () => {
  assert.equal(kind(git("git commit --amend --no-edit")), "ask");
});

test("既定ブランチへの push は拒否", () => {
  assert.equal(kind(git("git push origin main")), "block");
  assert.equal(kind(git("git push origin HEAD:main")), "block");
  assert.equal(kind(git("git push origin feat/x:refs/heads/master")), "block");
  assert.equal(kind(git("git push", { branch: "main" })), "block");
  assert.equal(kind(git("git push -u origin feat/x")), "allow");
  assert.equal(kind(git("git push")), "allow");
});

test("force push と --no-verify の push は拒否", () => {
  assert.equal(kind(git("git push --force origin feat/x")), "block");
  assert.equal(kind(git("git push -f origin feat/x")), "block");
  assert.equal(kind(git("git push --force-with-lease origin feat/x")), "block");
  assert.equal(kind(git("git push origin +feat/x")), "block");
  assert.equal(kind(git("git push --no-verify origin feat/x")), "block");
  assert.equal(kind(git("git push --mirror")), "block");
});

test("リモートブランチの削除は、マージ済みのものだけ許可", () => {
  assert.equal(kind(git("git push origin --delete feat/old")), "block");
  assert.equal(kind(git("git push origin :feat/old")), "block");
  assert.equal(kind(git("git push origin --delete feat/old", { merged: ["feat/old"] })), "allow");
});

test("push のブランチ名を動的に組み立てると拒否", () => {
  assert.equal(kind(git('git push origin "$BRANCH"')), "block");
});

test("-C や -c の前置オプションがあってもサブコマンドを判定できる", () => {
  assert.equal(kind(git('git -C /repo -c user.name=a commit -m "x"', { branch: "main" })), "block");
});

test("破壊的な操作は許可制", () => {
  for (const cmd of [
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git checkout -- .",
    "git checkout .",
    "git restore src/a.ts",
    "git branch -D old",
    "git stash drop",
    "git rebase main",
    "git switch --discard-changes main",
  ]) {
    assert.equal(kind(git(cmd)), "ask", cmd);
  }
});

test("通常の操作は許可", () => {
  for (const cmd of [
    "git status",
    "git diff",
    "git add -A",
    "git switch -c feat/a",
    "git checkout -b feat/a",
    "git restore --staged a.ts",
    "git clean -n",
    "git reset --soft HEAD~1",
    "git stash",
    "git log --oneline",
  ]) {
    assert.equal(kind(git(cmd)), "allow", cmd);
  }
});

test("既定ブランチ上の merge は拒否", () => {
  assert.equal(kind(git("git merge feat/x", { branch: "main" })), "block");
  assert.equal(kind(git("git merge main", { branch: "feat/x" })), "allow");
});

test("サブエージェントは commit・push・merge などを実行できない", () => {
  for (const cmd of [
    "git commit -m x",
    "git push origin feat/x",
    "git merge main",
    "git rebase main",
    "git tag v1",
    "git worktree add ../x",
  ]) {
    const v = git(cmd, { subagent: true });
    assert.equal(kind(v), "block", cmd);
  }
  assert.equal(kind(git("git diff", { subagent: true })), "allow");
  assert.equal(kind(git("git log", { subagent: true })), "allow");
});

test("worktree remove は、絶対パス・--force なし・自分が作ったものだけ", () => {
  assert.equal(kind(git("git worktree remove /w/a --force", { owned: ["/w/a"] })), "block");
  assert.equal(kind(git("git worktree remove ../a", { owned: ["/w/a"] })), "block");
  assert.equal(kind(git("git worktree remove /w/other", { owned: ["/w/a"] })), "block");
  assert.equal(kind(git("git worktree remove /w/a", { owned: ["/w/a"] })), "allow");
});

test("gh pr create / edit / merge は専用ツールに誘導して拒否", () => {
  for (const cmd of ["gh pr create --title x", "gh pr edit 1 --body y", "gh pr merge 1 --squash"]) {
    const v = gh(cmd);
    assert.equal(kind(v), "block", cmd);
    assert.match((v as { reason: string }).reason, /harness_pr_/);
  }
  assert.equal(kind(gh("gh pr view 1")), "allow");
  assert.equal(kind(gh("gh pr checks 1")), "allow");
  assert.equal(kind(gh("gh pr list")), "allow");
});

test("gh api は GET だけ許可", () => {
  assert.equal(kind(gh("gh api repos/o/r/pulls")), "allow");
  assert.equal(kind(gh("gh api -X DELETE repos/o/r/git/refs/heads/x")), "block");
  assert.equal(kind(gh("gh api repos/o/r/issues -f title=x")), "block");
  assert.equal(kind(gh("gh api --method=POST repos/o/r/issues")), "block");
});

test("gh のサブエージェントからの PR 書き込みと、危険なグループは拒否", () => {
  assert.equal(kind(gh("gh pr comment 1 --body x", { subagent: true })), "block");
  assert.equal(kind(gh("gh secret set X")), "block");
  assert.equal(kind(gh("gh repo delete o/r --yes")), "block");
  assert.equal(kind(gh("gh release create v1")), "block");
});
