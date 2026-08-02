# Release process

1. Update `package.json` and `package-lock.json` to the release version.
2. Add a dated entry to `CHANGELOG.md`.
3. Run the full local verification:

   ```sh
   npm ci
   npm test
   npm run check
   npm pack --dry-run
   npx ai validate
   npx ai sync
   git diff --exit-code
   ```

4. Open a pull request and wait for all CI jobs to pass.
5. Merge the release commit to the default branch.
6. Run the manual `Publish` GitHub Actions workflow with npm trusted
   publishing or the configured `NPM_TOKEN`.
7. Create and push the matching Git tag, for example `v0.1.0`.
8. Verify the package from npm in a clean temporary project.
