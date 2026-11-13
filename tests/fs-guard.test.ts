import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFs } from "../agent/extensions/harness/guards/fs.ts";
import { combine, type Verdict } from "../agent/extensions/harness/lib/verdict.ts";
import { HOME, input, inv } from "./helpers.ts";

type Over = Parameters<typeof input>[0];
const run = (cmd: string, over: Over = {}): Verdict =>
  combine(inv(cmd).map((i) => checkFs(i, input(over))));
const kind = (v: Verdict) => v.kind;

test("作業ルートと一時領域の内側の削除は許可", () => {
  assert.equal(kind(run(`rm -rf ${HOME}/Dev/seino914/app/dist`)), "allow");
  assert.equal(kind(run("rm -rf dist build")), "allow"); // cwd は作業ルートの内側
  assert.equal(kind(run("rm -f /tmp/a.txt")), "allow");
  assert.equal(kind(run("rm -rf /tmp/claude-1000/x")), "allow");
  assert.equal(kind(run("rm -rf ~/Dev/hobby/game/out")), "allow");
  assert.equal(kind(run("rm -rf ~/orca/workspaces/a")), "allow");
  assert.equal(kind(run("rm -rf $TMPDIR/x")), "allow");
});

test("外側の削除は拒否", () => {
  for (const cmd of [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf ~/Documents",
    "rm -rf /etc/hosts",
    "rm -rf ../../..",
    "rm -rf ~/Dev/kaishi",
    "rm -rf ~/Dev/kaishi/*",
    "rmdir /var/tmp/x",
    "rm --no-preserve-root -rf /tmp/x",
  ]) {
    assert.equal(kind(run(cmd)), "block", cmd);
  }
});

test("変数やコマンド置換で組み立てたパスの削除は拒否", () => {
  assert.equal(kind(run('rm -rf "$DIR"')), "block");
  assert.equal(kind(run("rm -rf $(pwd)/x")), "block");
  assert.equal(kind(run("rm -rf `echo /tmp/x`")), "block");
  assert.equal(kind(run("rm -rf ${HOME}/Documents")), "block");
});

test("cd と組み合わせた削除、xargs 経由の削除は拒否", () => {
  assert.equal(kind(run("cd /tmp && rm -rf x")), "block");
  assert.equal(kind(run("find /tmp/x -name '*.o' | xargs rm")), "block");
  assert.equal(kind(run("bash -c 'cd /tmp && rm -rf x'")), "block");
});

test("sh -c や置換の中の削除も検査する", () => {
  assert.equal(kind(run("sh -c 'rm -rf /etc'")), "block");
  assert.equal(kind(run("echo $(rm -rf /etc)")), "block");
});

test("symlink を辿った先が外側なら拒否する", () => {
  const i = input({});
  i.fs = { resolve: (p: string) => (p.includes("link") ? "/etc/secret" : p) };
  const [rm] = inv(`rm -rf ${HOME}/Dev/seino914/app/link`);
  assert.equal(checkFs(rm as NonNullable<typeof rm>, i).kind, "block");
});

test("glob は、glob の手前のディレクトリで判定する", () => {
  assert.equal(kind(run(`rm ${HOME}/Dev/seino914/app/*.tmp`)), "allow");
  assert.equal(kind(run("rm /etc/*.conf")), "block");
});

test("find の削除は、開始パスで判定する", () => {
  assert.equal(kind(run("find /tmp/x -name '*.o' -delete")), "allow");
  assert.equal(kind(run("find / -name '*.o' -delete")), "block");
  assert.equal(kind(run("find ~ -exec rm {} ;")), "block");
  assert.equal(kind(run("find . -name '*.ts'")), "allow");
});

test("rsync --delete は拒否", () => {
  assert.equal(kind(run("rsync -a --delete a/ b/")), "block");
});

test("pkill と killall は拒否", () => {
  assert.equal(kind(run("pkill node")), "block");
  assert.equal(kind(run("killall -9 node")), "block");
  assert.equal(kind(run("fuser -k 3000/tcp")), "block");
});

test("kill は、PID 指定か、kill $(lsof -ti :ポート) だけ許可", () => {
  assert.equal(kind(run("kill 1234")), "allow");
  assert.equal(kind(run("kill -9 1234 5678")), "allow");
  assert.equal(kind(run("kill -TERM 1234")), "allow");
  assert.equal(kind(run("kill -s KILL 1234")), "allow");
  assert.equal(kind(run("kill $(lsof -ti :3000)")), "allow");
  assert.equal(kind(run('kill -9 "$(lsof -ti :3000)"')), "allow");
  assert.equal(kind(run("kill $(pgrep node)")), "block");
  assert.equal(kind(run("kill $PID")), "block");
  assert.equal(kind(run("lsof -ti :3000 | xargs kill")), "block");
});

test("kill -9 -1 や kill 0、kill 1 は拒否(全プロセスの停止)", () => {
  assert.equal(kind(run("kill -9 -1")), "block");
  assert.equal(kind(run("kill -- -1")), "block");
  assert.equal(kind(run("kill 0")), "block");
  assert.equal(kind(run("kill 1")), "block");
  assert.equal(kind(run("kill -9 -123")), "block");
});
