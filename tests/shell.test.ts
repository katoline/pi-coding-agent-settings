import assert from "node:assert/strict";
import { test } from "node:test";
import { expandWord, invocations, parseShell } from "../agent/extensions/harness/lib/shell.ts";

const names = (cmd: string) => invocations(parseShell(cmd)).map((i) => i.name);

test("単純なコマンドと引数を取り出す", () => {
  const [inv] = invocations(parseShell("rm -rf foo bar"));
  assert.equal(inv?.name, "rm");
  assert.deepEqual(
    inv?.args.map((w) => w.value),
    ["-rf", "foo", "bar"],
  );
});

test("; && || | & と改行でコマンドを分ける", () => {
  assert.deepEqual(names("a; b && c || d | e & f\ng"), ["a", "b", "c", "d", "e", "f", "g"]);
});

test("クォートの中の区切りは分けない", () => {
  assert.deepEqual(names("echo 'a; rm -rf /' \"b && c\""), ["echo"]);
});

test("コマンド置換の中のコマンドも取り出す", () => {
  const parsed = parseShell("echo $(rm -rf /tmp/x) `kill 1`");
  const found = invocations(parsed).map((i) => i.name);
  assert.ok(found.includes("rm"));
  assert.ok(found.includes("kill"));
  const echo = parsed.commands.find((c) => c.words[0]?.value === "echo");
  assert.ok(echo?.words.some((w) => w.dynamic));
});

test("ダブルクォート内のコマンド置換も取り出す", () => {
  assert.ok(names('echo "x $(rm -rf /)"').includes("rm"));
});

test("変数を含む語は dynamic になる", () => {
  const [inv] = invocations(parseShell('rm -rf "$DIR"/x ${Y} $Z'));
  assert.deepEqual(
    inv?.args.map((w) => w.dynamic),
    [false, true, true, true],
  );
});

test("単引用符の中の $ は dynamic にならない", () => {
  const [inv] = invocations(parseShell("rm '$DIR'"));
  assert.equal(inv?.args[0]?.dynamic, false);
});

test("glob を検出する", () => {
  const [inv] = invocations(parseShell("rm *.tmp 'a*b'"));
  assert.deepEqual(
    inv?.args.map((w) => w.glob),
    [true, false],
  );
});

test("cd のあとのコマンドは afterCd になる", () => {
  const found = invocations(parseShell("cd /tmp && rm -rf x"));
  assert.equal(found.find((i) => i.name === "rm")?.afterCd, true);
  assert.equal(found.find((i) => i.name === "cd")?.afterCd, false);
});

test("ラッパー(env、nohup、time、パス付き)を外す", () => {
  assert.deepEqual(names("FOO=1 env -u A BAR=2 nohup time /bin/rm -rf a"), ["rm"]);
  assert.deepEqual(names("timeout 10 sleep 1"), ["sleep"]);
});

test("xargs 経由は viaXargs になる", () => {
  const [inv] = invocations(parseShell("find . | xargs -n1 rm -rf"));
  const rm = invocations(parseShell("find . | xargs -n1 rm -rf")).find((i) => i.name === "rm");
  assert.ok(inv);
  assert.equal(rm?.viaXargs, true);
});

test("sh -c の中身を入れ子として取り出す", () => {
  const parsed = parseShell("bash -lc 'cd /x && rm -rf y'");
  assert.ok(invocations(parsed).some((i) => i.name === "rm" && i.nested));
});

test("sh -c に動的な文字列を渡すと opaque になる", () => {
  assert.equal(parseShell('sh -c "$CMD"').opaque, true);
  assert.equal(parseShell("eval $CMD").opaque, true);
});

test("ヒアドキュメントの本体はコマンドとして扱わない", () => {
  const parsed = parseShell("cat <<'EOF'\nrm -rf /\nEOF\necho done");
  assert.equal(parsed.ok, true);
  assert.deepEqual(names("cat <<'EOF'\nrm -rf /\nEOF\necho done"), ["cat", "echo"]);
});

test("リダイレクト先を取り出す", () => {
  const [cmd] = parseShell("echo hi > .env 2>&1").commands;
  assert.equal(cmd?.redirects[0]?.target.value, ".env");
  assert.equal(cmd?.redirects.length, 1);
});

test("クォートの閉じ忘れは ok:false", () => {
  assert.equal(parseShell("echo 'abc").ok, false);
  assert.equal(parseShell('echo "abc').ok, false);
});

test("予約語の後ろのコマンドを見る", () => {
  assert.ok(names("for x in a b; do rm $x; done").includes("rm"));
  assert.ok(names("if true; then rm x; fi").includes("rm"));
  assert.ok(names("{ rm -rf x; }").includes("rm"));
});

test("コメントは無視する", () => {
  assert.deepEqual(names("echo a # rm -rf /"), ["echo"]);
});

test("expandWord は ~ と TMPDIR、HOME だけ展開する", () => {
  const env = { home: "/home/u", tmpdir: "/tmp" };
  const w = (value: string, dynamic = false) => ({ value, dynamic, glob: false });
  assert.equal(expandWord(w("~/a"), env), "/home/u/a");
  assert.equal(expandWord(w("$TMPDIR/x", true), env), "/tmp/x");
  assert.equal(expandWord(w("${HOME}/x", true), env), "/home/u/x");
  assert.equal(expandWord(w("$FOO/x", true), env), null);
  assert.equal(expandWord(w("$(pwd)", true), env), null);
  assert.equal(expandWord(w("~root/x"), env), null);
});
