# Repository Guidelines

## Project Structure & Module Organization
- `my-medusa-store/` — Medusa backend (TypeScript). Key paths: `src/`, `integration-tests/http/`, `medusa-config.ts`.
- `medusa-mcp/` — Model Context Protocol server. Key paths: `src/`, `dist/`, `oas/`.
- `my-medusa-store-storefront/` — Next.js 15 storefront. Key paths: `src/`, `public/`.
- Infra & CI — `docker-compose.yml` (Postgres), `.github/` (PR template, workflows), `azure-pipelines.yml`.

## Build, Test, and Development Commands
- Infra (root): `docker compose up -d` — start Postgres on `5432`.
- Backend: `cd my-medusa-store && npm ci && npm run dev` (serves on `9000`). Build: `npm run build`.
- Backend tests: `npm run test:unit`, `npm run test:integration:http` (requires Postgres; set `DATABASE_URL` if not using Docker).
- MCP: `cd medusa-mcp && npm ci && npm run dev` or `npm run build && npm start`. Lint: `npm run lint`. Inspector: `npm run dev:inspector`.
- Storefront: `cd my-medusa-store-storefront && yarn && yarn dev` (runs on `8000`). Build: `yarn build`; start: `yarn start`.

## Coding Style & Naming Conventions
- General: TypeScript, `camelCase` for variables/functions, `PascalCase` for classes, descriptive names.
- `medusa-mcp`: ESLint + Prettier (Google base). 4-space indent, semicolons, double quotes. Run `npm run lint`.
- `my-medusa-store`: ESLint (TS recommended). Follow existing file style; resolve all lint warnings before PR.
- Storefront: Next lint + Prettier (`.prettierrc`: 2 spaces, no semicolons, trailing commas). Run `yarn lint`.

## Testing Guidelines
- Framework: Jest in `my-medusa-store`.
- Naming: unit tests `*.unit.spec.ts` under `src/**/__tests__`; integration tests in `integration-tests/http/*.spec.ts`.
- Keep tests deterministic; mock external services. Run unit tests locally before integration.

## Commit & Pull Request Guidelines
- Commits: short, imperative prefixes as in history (e.g., `bugfix:`, `lint:`, `feat:`, `chore:`). Optional scope: `feat(storefront): …`.
- PRs: use `.github/PULL_REQUEST_TEMPLATE.md`. Include clear description, linked issues, test evidence, and screenshots for UI changes.

## Security & Configuration Tips
- Do not commit secrets. Copy env templates: backend `my-medusa-store/.env.template` → `.env`, MCP `medusa-mcp/.env-template` → `.env`, storefront `.env.template` → `.env.local`.
- Ensure CORS and `DATABASE_URL` are set. Use Node 20+ (matches CI).

## Agent-Specific Instructions
- Limit edits to the relevant package. Run its linter and tests before proposing changes. Avoid unrelated refactors and keep patches minimal.

