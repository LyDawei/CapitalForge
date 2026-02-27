# Repository Guidelines

## Project Structure
- `src/`: TypeScript application code.
- `src/core/`: Orchestration and domain flow.
- `src/services/`: External integrations (e.g., Alpaca, LLM, DB).
- `src/agents/`: Strategy/agent logic.
- `scripts/`: One-off operational scripts (e.g., `runCycle.ts`).
- `prisma/`: Prisma schema and migrations.
- `ARCHITECTURE.md`: High-level system overview.
- `.env.example`: Required environment variables.

## Build, Test, and Development Commands
- `npm run dev`: Run the service via `ts-node`.
- `npm run build`: Compile TypeScript into `dist/`.
- `npm run start`: Run the compiled build.
- `npm run run-cycle`: Run a single trading cycle script.
- `npm test`: Run Jest test suite.
- `npm run test:coverage`: Run tests with coverage output.
- `npm run docker:compose:up`: Start the local stack (DB, services).
- `npm run prisma:generate`: Generate Prisma client.
- `npm run prisma:migrate`: Apply local DB migrations (compose DB).

## Coding Style & Naming
- TypeScript, 2-space indentation, single quotes, semicolons (match existing files).
- Prefer explicit types at module boundaries; keep functions small and side-effect scope clear.
- Filenames use kebab or dot suffix patterns (e.g., `llm.mock.ts`, `config.test.ts`).
- No repo-level linter/formatter configured; keep formatting consistent with nearby files.

## Testing Guidelines
- Framework: Jest with `ts-jest`.
- Test files: `**/*.test.ts` under `src/`.
- Coverage is available via `npm run test:coverage`.
- Add tests alongside related modules (e.g., `src/services/foo.test.ts`).

## Commit & Pull Request Guidelines
- Commit history is mixed; follow a concise, imperative subject line.
- Optional convention: `type: message` (example: `fix: handle null quote`).
- PRs should include a clear summary, test evidence, and any config or migration notes.
- For changes touching DB or external APIs, describe required env vars and run steps.

## Security & Configuration
- Copy `.env.example` to `.env` and keep secrets out of Git.
- Default DB connections use Docker Compose; confirm URLs before running migrations.