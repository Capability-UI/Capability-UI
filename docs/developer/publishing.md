# Publishing `@capability-ui/core`

Until the package is on the public npm registry, `0.2.0` is published to GitHub Packages under the `Capability-UI` org (`@capability-ui` scope). The tarball is MIT-licensed. Visibility is `restricted`, so consumers authenticate with a GitHub PAT that can read packages.

## Package layout

`package.json` maps the public ESM entry to compiled output:

- `main` / `exports.import`: `dist/src/index.js`
- `exports.types`: `dist/src/index.d.ts`
- `bin.cup`: `dist/src/bin/cup.js`
- `files`: `dist/src`, `sql`, `README.md`, `LICENSE` (tests under `dist/test` are not published)
- `publishConfig.registry`: `https://npm.pkg.github.com`
- `publishConfig.access`: `restricted`

`prepack` runs `npm run build` so `npm pack` and `npm publish` always emit `dist/` first. Do not put tokens in `.npmrc`. The committed `.npmrc` only scopes `@capability-ui` to GitHub Packages.

## Publish from CI

Workflow: `.github/workflows/package.yml`.

The `publish` job needs `packages: write` on `GITHUB_TOKEN` (set on that job). Do not add a long-lived npm token for this path.

The org must allow that GitHub App installation to create packages. A 403 like `installation not allowed to Create organization package` means Actions (or the PAT) cannot create org packages yet. An org owner should enable package creation for GitHub Actions, then retry the tag or dispatch. A human PAT with `write:packages` (SSO-authorized) can also publish once:

```bash
NODE_AUTH_TOKEN=TOKEN npm publish
```

Publish `0.2.0` after this workflow is on `main`:

1. Confirm `package.json` `version` is `0.2.0`.
2. Tag the merge commit and push the tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Or run **Actions > Package > Run workflow** (`workflow_dispatch`) on `main` if the version has not been published yet.

A tag `vX.Y.Z` must match `package.json` `version`. Republishing the same version fails; bump the version for a new release.

## Consumer install

Use a PAT with `read:packages` (and SSO authorized for the `Capability-UI` org if the org requires it). Do not commit the token.

```ini
# .npmrc
@capability-ui:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=TOKEN
```

```bash
npm i @capability-ui/core@0.2.0
```

Equivalent environment-based auth:

```bash
export NODE_AUTH_TOKEN=TOKEN
npm i @capability-ui/core@0.2.0
```

Package URL after the first successful publish: `https://github.com/orgs/Capability-UI/packages/npm/package/core`.
