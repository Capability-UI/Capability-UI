# Developer notes: Cloud Agent environment

`.cursor/environment.json` defines the Cursor Cloud Agent dev environment for this repo. It targets the repository's full development experience: the dependency-free core, the three example hosts, and (when checked out) the sibling marketing site.

## Layout

| File | Role |
|---|---|
| `.cursor/environment.json` | Environment definition: `install`, `terminals`, `ports`, `repositoryDependencies` |
| `.cursor/install.sh` | Idempotent setup: install + build core, install examples, install + build the sibling site when present |
| `.cursor/start.sh` | Launches the combined marketing + `/play` host when the `Website` sibling exists; otherwise stays idle |

The default Cursor base image already provides Node 22, `git`, and `curl`, so no Dockerfile is used. The package requires Node `>=20`.

## Install

`install` runs `bash .cursor/install.sh` after checkout. It is idempotent (a second run reports `up to date`):

1. `npm install` then `npm run build` for the core (produces `dist/`, needed by the `cup` bin and by the site's `file:../Capability-UI` dependency).
2. `npm install --prefix examples`.
3. If a sibling `Website` repo is checked out (`../Website`), `npm install` and `npm run build` (Astro) there. The step is skipped cleanly when the site is absent, so setup stays valid without it.

## Runtime services (terminals)

| Terminal | Command | URL |
|---|---|---|
| crm (Meridian) | `npm --prefix examples run crm` | http://127.0.0.1:8782 |
| support (Clearline) | `npm --prefix examples run support` | http://127.0.0.1:8783 |
| agent (Keel) | `npm --prefix examples run agent` | http://127.0.0.1:8784 |
| site | `bash .cursor/start.sh` | http://127.0.0.1:4321 (marketing + `/play/{crm,support,agent}`) |

Each example host serves its product UI, `/explorer.html`, `/api/*`, and `POST /mcp`. The `site` terminal serves the static Astro site and mounts the same three apps at `/play/*` in one origin. The standalone ports (8782-8784) remain the ones the `astro dev` example iframes expect.

## Cross-repo dependency

The marketing site is a separate repository ([Capability-UI/Website](https://github.com/Capability-UI/Website)) that depends on this package via `file:../Capability-UI` and expects the sibling clone layout. `repositoryDependencies` lists it so the generated GitHub token can access it. The install and start scripts guard on its presence so this environment works whether or not the site is checked out alongside.

## Validation

Full local checks used to validate the environment:

```bash
npm run build && npm run check && npm test   # core: build, typecheck, 27 tests
npm --prefix examples test                    # examples: 5 smoke tests
bash .cursor/install.sh                        # idempotent setup, run twice
```
