Releases follow semantic versioning, judged from the consumer's perspective: if
existing code stops compiling or changes behavior, it is a major release, no
matter how small the diff.

Every user-visible change ships with a changeset describing the impact, not the
implementation. "Adds `retry` option to `fetchWithBackoff`" is useful;
"refactors the retry loop" is not.

Never publish from a local machine. The release workflow publishes from a tag,
so the published artifact always matches a reviewed commit.
