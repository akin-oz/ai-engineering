# Engineering guidelines

This project is a small HTTP service. Keep changes focused and reversible.

## Testing policy

Every pull request runs the full test suite before merging. Bug fixes should
have a test that reproduces the report.

## Release policy

Releases are cut from main and tagged with semantic versions. Anything that
changes a response shape is a major release, however small the diff.

## Dependency policy

New dependencies need a justification in the pull request. Prefer the standard
library.
