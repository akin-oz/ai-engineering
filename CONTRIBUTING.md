# Contributing

## Development

Requirements:

- Node.js 20 or newer
- npm

Install dependencies and run the checks:

```sh
npm ci
npm test
npm run check
```

Before opening a pull request, verify generated artifacts:

```sh
npx ai sync
git diff --exit-code
```

Keep `.ai/` as the source of truth. Do not edit generated runtime artifacts by
hand; regenerate them from the source workspace.

Runtime-specific behavior belongs in an adapter. Changes to the public API,
manifest format, or adapter contract require documentation and tests.
