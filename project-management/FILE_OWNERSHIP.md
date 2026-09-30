# File ownership

Who is primary on each sensitive or shared area, which manager it answers to,
and who must review a change. The machine-readable copy is `file_ownership` in
PROJECT_CONFIG.json (rendered on `dashboard/files.html`); keep the two in step.

| Path                                                                  | Primary                    | Manager | Mandatory review                             | Min. level |
| --------------------------------------------------------------------- | -------------------------- | ------- | -------------------------------------------- | ---------- |
| `apps/api/src/vault/`                                                 | Security Engineer          | PM-06   | PM-04, Database Architect                    | L4         |
| `apps/api/src/auth/`, `apps/api/src/account/`                         | Auth & RBAC Specialist     | PM-04   | Security Engineer, PM-06                     | L4         |
| `apps/api/src/checkout/`                                              | Integration Engineer       | PM-04   | Security Engineer, PM-01                     | L4         |
| `apps/api/src/fulfillment/`                                           | Backend Architect          | PM-04   | Security Engineer                            | L4         |
| `apps/api/src/config/env.ts`                                          | Backend Architect          | PM-04   | DevOps, Security Engineer                    | L3         |
| `apps/api/src/` (other modules)                                       | Senior Backend Engineer    | PM-04   | Backend Architect                            | L2         |
| `packages/db/prisma/` (schema, migrations, role SQL)                  | Database Architect         | PM-04   | PM-06                                        | L4         |
| `packages/db/scripts/` (importers, doctor, roles)                     | Database Architect         | PM-04   | Security Engineer                            | L3         |
| `packages/contracts/`                                                 | API Architect              | PM-04   | Frontend Architect                           | L4         |
| `packages/seo/`                                                       | Technical SEO Specialist   | PM-05   | PM-04                                        | L3         |
| `packages/ui/src/tokens.css`                                          | Design System Architect    | PM-03   | Frontend Architect, Accessibility Specialist | L3         |
| `packages/i18n/`                                                      | Search Engineer            | PM-04   | RTL & Localization Specialist                | L3         |
| `apps/storefront/src/proxy.ts` (routing + CSP)                        | Frontend Architect         | PM-04   | Security Engineer, Technical SEO             | L4         |
| `apps/storefront/src/app/`                                            | Senior Frontend Engineer   | PM-04   | Frontend Architect, PM-03, Technical SEO     | L2         |
| `apps/storefront/messages/`                                           | RTL & Localization         | PM-03   | Content Strategist                           | L2         |
| `apps/admin/src/`                                                     | Senior Frontend Engineer   | PM-04   | Frontend Architect, PM-03                    | L2         |
| `workers/jobs/`                                                       | Backend Architect          | PM-04   | SRE                                          | L3         |
| `.github/workflows/`                                                  | DevOps Engineer            | PM-06   | PM-04                                        | L3         |
| `docs/deployment.md`                                                  | DevOps Engineer            | PM-06   | Documentation Architect                      | L2         |
| `docs/plan.html`                                                      | Executive Product Director | —       | PM-01; republish to the same artifact path   | L3         |
| `.env.example`, `scripts/generate-secrets.ts`, `scripts/env-check.ts` | DevOps Engineer            | PM-06   | Security Engineer                            | L3         |
| `eslint.config.mjs`, `.prettierrc`, `tsconfig*.json`, `turbo.json`    | Frontend Architect         | PM-04   | DevOps Engineer                              | L3         |
| `project-management/`                                                 | Documentation Architect    | Exec    | —                                            | L2         |

## Rules that come with ownership

- **Level floor.** A change inside a path is at least that path's level, even
  if the diff is one line.
- **`vaultPrisma`** is imported only under `apps/api/src/vault/`. A PR that
  imports it anywhere else is rejected by the Security Engineer on sight.
- **Structured data** is produced only in `packages/seo/src/jsonld.ts`.
- **`Old Website/`** has no owner in the repo because it must never be in the
  repo. It is the owner's secret asset.
- **Toolchain bumps** (TypeScript, Nest, Prisma) are L3 at minimum and must
  consult the toolchain notes before changing a pin.
