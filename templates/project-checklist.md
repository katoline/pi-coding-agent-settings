# New project setup

- Copy flake.nix, .envrc, biome.json and the Quality workflow. Generate and commit flake.lock with `nix flake lock`.
- Pin Node and package-manager versions; commit package-lock.json, use npm ci --ignore-scripts in CI.
- Add Biome, TypeScript and real application tests to a single `npm run check`; include the required build and a functional smoke test where appropriate.
- Configure harness.config.json checks for this project in a trusted harness installation. Commands are argv arrays, never shell strings. The default snapshot runner supports npm projects; add a reviewed container runner for other languages/Nix-native services before using the gate.
- Document required services, test data, environment variable names and credential destinations. Never commit values.
- Enable GitHub rulesets: protect main/master/default branch; require PR, independent approvals and the quality check; disallow force pushes and deletion; remove agent/admin bypass where applicable. Restrict the agent GitHub App's direct-update permission with rulesets.
- Add CODEOWNERS for .github, harness policies and security-sensitive code using real team names (do not invent accounts).
- Verify a rejected direct main push using a disposable repository, and verify a failing test blocks commit/push/PR.
- For an existing service, honor its existing toolchain and lockfiles rather than replacing them with the template.
