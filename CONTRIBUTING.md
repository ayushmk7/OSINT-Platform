# Contributing

## Setup

Requires Node.js 22.22.2 or newer (`better-sqlite3` 13 needs Node 22+).

```bash
make install   # npm install for root + backend + frontend workspaces
make dev       # backend on :4000, frontend via Vite
```

Optional backend config: copy `backend/.env.example` to `backend/.env`.

## Branches and commits

- Branch from `main`; open a pull request back to `main`.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, with an optional scope such as `fix(frontend): ...`.

## Before opening a PR

```bash
make test lint build
```

CI (`.github/workflows/ci.yml`) runs the same lint, test and build steps on every push and PR to `main`.

## Adding a data source

Sources are YAML files in `sources.d/`. See [docs/data-sources.md](docs/data-sources.md) for the schema; `skills/onboard-source/examples/` has reference definitions.

## Code style

Prettier is configured in `.prettierrc` (single quotes, 100-column width, no trailing commas). Run `make format` before committing. TypeScript must pass `npm run lint` (`tsc --noEmit`) in both workspaces.
