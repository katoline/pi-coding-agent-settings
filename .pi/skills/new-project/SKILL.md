---
name: new-project
description: Bootstrap a new JS/TS project with Nix, Biome, tests and required CI gates.
---

Use the host `scripts/init-project.mjs DESTINATION` only for an empty directory (an empty initialized .git is allowed). It refuses overwrites. Do not replace an existing service's toolchain.

Define the actual project first, then implement its src and regression tests. Run `nix develop`, `npm install --ignore-scripts` once to create package-lock.json, then frozen `npm ci --ignore-scripts` on subsequent runs. The template deliberately rejects a zero-test project. Include any required application build and functional smoke test in npm run check. Do not add trivial tests just to satisfy the gate.

Use flake.nix and its committed flake.lock for the toolchain. Keep the language lockfile too. Add documented services/credential requirements without secret values. Enable Quality on both push and pull_request. Set GitHub rulesets and real CODEOWNERS as described in templates/project-checklist.md. Inspect and test configuration before claiming readiness. Git publication uses the host gate and never directly targets the protected branch.
