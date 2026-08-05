# Engineering guidelines

This project is a small HTTP service. Keep changes focused and reversible.

## Testing policy

Every pull request runs the full test suite before it can merge. Bug fixes start
with a failing test that reproduces the report, written before the fix.

## Review policy

At least one other engineer approves every change. Reviewers check the failure
modes first: what happens on invalid input, on a timeout, and on the second
request.

## Release policy

Releases are cut from main and tagged with semantic versions. Anything that
changes a response shape is a major release, however small the diff.
