# Release process

Releases are staged by CI and approved by a human. There is no npm token in
this repository or in its GitHub secrets: the publish job authenticates to npm
through OIDC as a trusted publisher, and npm trusts exactly one workflow file,
`.github/workflows/publish.yaml`, in this repository.

That workflow can only *stage* a release. Turning a staged release into a
published one takes the maintainer's 2FA key, which a compromised CI run cannot
supply.

A released version has all four of these, or none: a git tag, an npm publish, a
`CHANGELOG.md` section, and a `.github/releases/vX.Y.Z.md` note. The changelog
may never claim a release npm does not have. The release workflow enforces the
first three before it stages anything.

## Steps

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
   npm audit
   npm pack --dry-run
   node bin/aie.mjs validate --strict
   node bin/aie.mjs check --strict
   node scripts/verify-dogfood.mjs . examples/basic examples/typescript-library
   git diff --exit-code
   ```

5. Open a pull request and wait for all CI jobs to pass, including the workflow
   lint.
6. Merge to the default branch.
7. Tag the release commit and push the tag:

   ```sh
   git tag v0.2.0        # git tag -s once signing keys are set up
   git push origin v0.2.0
   ```

   Only repository admins can create tags, because pushing a version tag is
   what triggers a release.

8. The `Release` workflow verifies the tag, the version, the changelog, the
   release note, the tests, and the compiled output, then stages the release.
9. **Approve the staged release.** Open **Staged Packages** from the user menu
   on npmjs.com, or run `npm stage approve`, and confirm with 2FA. Nothing
   reaches users until this step.
10. Verify the published package in a clean temporary project: `npx aie init`
    followed by `npx aie sync` must produce a non-empty `CLAUDE.md` and
    `AGENTS.md`.

## If a release goes wrong

Do not delete or move a published tag — releases are immutable, and rewriting
one is exactly the attack the setup above defends against. Ship a patch release
instead.

A staged release that should not go out can simply be left unapproved; it
expires without ever reaching users.
