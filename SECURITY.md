# Security Policy

## Supported Versions

This project is under active development. Only the latest version on the `main` branch receives security fixes.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Older commits/tags | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainer directly, or use GitHub's private "Report a vulnerability" feature (Security tab → Advisories) if enabled on this repository.
3. Include a clear description, steps to reproduce, and the potential impact.

You can expect an initial response within a few days. Once a fix is available, we will coordinate on a disclosure timeline.

## Security Practices in This Project

- **PIN storage**: New PIN verifiers use salted scrypt. Existing unsalted SHA-256 verifiers are accepted for migration and upgraded after a successful login. Verifiers are not returned by the auth API. PINs remain lower-entropy than passwords; use a long PIN and enable deployment-level protections.
- **Sessions**: Session state is stored in PostgreSQL using `connect-pg-simple`. Login and registration rotate the session ID. Cookies are HttpOnly and SameSite=Lax, and Secure in production. Production startup rejects a missing or short `SESSION_SECRET`; development uses a process-random secret.
- **Administrator access**: There is no default administrator account. Platform administration is restricted to IDs explicitly listed in `PLATFORM_ADMIN_USER_IDS`; username values are not authorization.
- **Request authorization**: Server-side permission checks now protect checkout, inventory writes, expenses, reports, and restaurant order operations. Store-scoped transactions cover POS checkout, restaurant order creation, online-order cancellation stock returns, and product changes. This does not establish complete tenant isolation across every legacy endpoint/entity.
- **Authentication throttling**: Auth endpoints use a configurable per-IP in-memory rate limit and owner accounts retain failed-login lockout. The in-memory limit is not shared across multiple server instances.
- **Input handling**: Financial, stock, product, expense, and ordering paths apply explicit server-side validation. Not every legacy endpoint uses a shared schema validator.
- **Data safety**: The current database schema is PostgreSQL-backed. Automated backup, restore drills, full migration coverage, and production security verification are not yet implemented.

These controls are partial engineering improvements, not a security certification or a claim that the application is production-ready. See `ENGINEERING_READINESS.md` for tested scope and remaining blockers.

## Secrets & Configuration

Never commit real secrets (`DATABASE_URL`, `SESSION_SECRET`, API keys, or bootstrap PINs) to source control. Use `.env` locally (already git-ignored) and your hosting provider's secret manager in production. See `.env.example` for configuration names only.

## Dependency Updates

Dependencies are tracked in `package.json`/`package-lock.json`. Run `npm audit` periodically and update vulnerable packages promptly, especially for the Express/session/database layers that handle authentication.
