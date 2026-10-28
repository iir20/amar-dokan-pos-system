# Contributing to Amar Dokan POS

Thanks for your interest in improving Amar Dokan POS! This is a full-stack app (React/Vite client + Express/PostgreSQL backend), so please read this before opening a PR.

## Getting Set Up

1. Fork and clone the repository.
2. Copy `.env.example` to `.env` and point `DATABASE_URL` at a PostgreSQL database you control.
3. Install dependencies: `npm install`
4. Apply the documented schema migrations. Use `npm run db:push` only for a brand-new empty database before starting the app; review and cancel any proposal to delete or rename existing tables.
5. Start the dev server: `npm run dev`

## Project Conventions

- **No client-side persistence.** All data must go through the Express API (`server/routes.ts` → `server/storage.ts` → PostgreSQL). Do not reintroduce local/offline storage (e.g. IndexedDB) for core data.
- **Shared types.** Database shapes live in `shared/schema.ts` (Drizzle) and are re-exported as TypeScript types. Reuse these rather than redefining shapes in the client.
- **API client.** Add new endpoints to `services/storage.ts` on the client rather than calling `fetch` directly from components.
- **Data fetching.** Use the `useApiData` hook for reads and call `refetch()` after mutations, matching the existing components' pattern.

## Making Changes

1. Create a feature branch: `git checkout -b feature/my-change`
2. Make your changes, keeping commits focused and descriptive.
3. Run a type-check locally: `npx tsc --noEmit`
4. Test the affected flows manually (there is no automated end-to-end test suite yet — contributions adding one are welcome).
5. Open a pull request describing what changed and why.

## Reporting Bugs / Requesting Features

Please open a GitHub issue with clear reproduction steps (for bugs) or a clear use case (for features). For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
