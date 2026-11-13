#!/usr/bin/env node
/**
 * Nix セットアップ: Nix の開発環境、Biome、Dependabot、CI を、対象のプロジェクトに作る。
 * 既存のファイルは上書きしない。`--dry-run` で、作るものを表示するだけにできる。
 *
 * 使い方: node setup.mjs <プロジェクトのディレクトリ> [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templates = path.join(here, "..", "templates");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());

if (!existsSync(target)) {
  console.error(`ディレクトリがありません: ${target}`);
  process.exit(1);
}

/** [テンプレートのファイル名, プロジェクト内の出力先] */
const files = [
  ["flake.nix", "flake.nix"],
  ["envrc", ".envrc"],
  ["biome.json.template", "biome.json"],
  ["dependabot.yml", ".github/dependabot.yml"],
  ["quality.yml", ".github/workflows/quality.yml"],
];

const created = [];
const skipped = [];

for (const [name, out] of files) {
  const dest = path.join(target, out);
  if (existsSync(dest)) {
    skipped.push(out);
    continue;
  }
  created.push(out);
  if (dryRun) continue;
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(path.join(templates, name), "utf8"));
}

// package.json: 無ければ、最小のもの(check スクリプトつき)を作る
const pkgPath = path.join(target, "package.json");
if (existsSync(pkgPath)) {
  skipped.push("package.json");
} else {
  created.push("package.json");
  if (!dryRun) {
    const pkg = {
      name: path.basename(target),
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { check: "biome check . && node --test", test: "node --test" },
      devDependencies: {},
    };
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

// .gitignore: 必要な行だけを足す
const ignorePath = path.join(target, ".gitignore");
const wanted = [
  "node_modules/",
  ".env",
  ".env.*",
  "!.env.example",
  ".direnv/",
  "result",
  ".harness/",
];
const current = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8").split("\n") : [];
const missing = wanted.filter((line) => !current.includes(line));
if (missing.length > 0) {
  created.push(`.gitignore(${missing.length} 行を追加)`);
  if (!dryRun) {
    const base =
      current.length > 0 && current.at(-1) !== "" ? `${current.join("\n")}\n` : current.join("\n");
    writeFileSync(ignorePath, `${base}${missing.join("\n")}\n`);
  }
}

const label = dryRun ? "(dry-run: 何も書いていません)" : "";
console.log(`対象: ${target} ${label}`.trim());
for (const f of created) console.log(`作成: ${f}`);
for (const f of skipped) console.log(`スキップ(すでにある): ${f}`);
console.log(
  "\n次の作業: nix flake lock、npm install --ignore-scripts、flake.lock と package-lock.json のコミット、" +
    "実際のソースとテストの追加、GitHub のブランチ保護の設定。",
);
