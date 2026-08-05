# Release process

A released version has all four of these, or none: a git tag, an npm publish, a
`CHANGELOG.md` section, and a `.github/releases/vX.Y.Z.md` note. The changelog
may never claim a release npm does not have.

1. Update `package.json` and `package-lock.json` to the release version.
2. Add a dated `CHANGELOG.md` entry and write `.github/releases/vX.Y.Z.md`.
3. Audit the README against reality: the quick start, the supported-runtime
   list, the command table, and every claim about this repository must be true
   at this commit.
4. Run the full local verification:

   ```sh
   npm ci
   npm test
   npm run check
   npm pack --dry-run
   node bin/aie.mjs validate --strict
   node bin/aie.mjs check --strict
   node scripts/verify-dogfood.mjs . examples/*/
   git diff --exit-code
   ```

5. Open a pull request and wait for all CI jobs to pass.
6. Merge the release commit to the default branch.
7. Run the manual `Publish` GitHub Actions workflow with npm trusted publishing
   or the configured `NPM_TOKEN`.
8. Create and push the matching git tag, for example `v0.2.0`.
9. Verify the published package in a clean temporary project: `npx aie init`
   followed by `npx aie sync` must produce a non-empty `CLAUDE.md` and
   `AGENTS.md`.
