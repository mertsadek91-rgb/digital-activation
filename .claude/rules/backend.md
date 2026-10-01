---
paths:
  - "apps/api/**"
  - "workers/**"
---

# Backend (NestJS 12 on Fastify)

- Routes live under `/v1`, except the health probes listed in `UNPREFIXED_ROUTES` (`/health`, `/health/ready`, and the key-gated `/health/sweeps` and `/health/delivery`). Every Json column has a zod shape in `packages/contracts`; change the contract first (routing domain `contracts`, L4).
- Throttling is opt-in. `ExplicitThrottlerGuard` only applies to routes with `@Throttle` / `@VisitorThrottle`, so a new public write needs one.
- Staff auth is `StaffGuard` + `@Roles`, with OWNER always passing. Customer auth is the `da_customer` session checked in the controller. Never trust a client-supplied amount, currency or owner id (see `checkout.controller.ts` `pay`).
- Scheduled work is `@nestjs/schedule` crons inside the API, each behind a Postgres advisory lock taken with `withAdvisoryLock` (`apps/api/src/common/advisory-lock.ts`, transaction-scoped). Never take a session lock with one pooled `$queryRaw` and release it with another: the unlock can land on a different connection (BUG-0001, fixed by TASK-0010).
- Mail: `capture` transport is refused in production; transactional and marketing senders are separate domains.
- Log with the pino logger; its redaction list covers headers, credential fields, URLs and emails. Never log a licence plaintext, token or order note.
- Tests: `pnpm --filter @da/api test` (unit, vitest) and `test:int` (DB-backed; needs a disposable Postgres, never the `.env` database).
- NestJS depends on `emitDecoratorMetadata`, so TypeScript stays on 6.0.x.
