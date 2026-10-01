# TASK-0015: Staff Route & Role Scope Audit Report

**Date:** 2026-09-30  
**Primary Agent:** Security Engineer (`security-engineer`)  
**Responsible Manager:** PM-06 (`pm-06`)  
**Authority Level:** L1 (Observe / Audit)  
**Status:** Complete Audit Report

---

## 1. Executive Summary

An audit of all 23 controllers guarded by `StaffGuard` in `apps/api/src/` was conducted to evaluate role enforcement and least-privilege scoping across the admin API.

Under the current `StaffGuard` implementation (`apps/api/src/auth/staff.guard.ts:78`):

```typescript
const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
  ROLES_KEY,
  [context.getHandler(), context.getClass()],
);

if (!required || required.length === 0) return true;
```

If a route or controller lacks `@Roles(...)`, **any authenticated staff role (including `READONLY`) is granted access by default**.

---

## 2. Route Inventory & Role Exposure Matrix

| Route                               | Method | Current Allowed Roles                              | Sensitive Data Returned                                                                  | Severity   | Recommended Role Scope           |
| :---------------------------------- | :----- | :------------------------------------------------- | :--------------------------------------------------------------------------------------- | :--------- | :------------------------------- |
| `/admin/dashboard`                  | `GET`  | No `@Roles` (All staff incl. `READONLY`)           | Total store revenue (USD/SAR), daily gross, recent orders with customer emails & amounts | **HIGH**   | `ADMIN`, `OWNER` only            |
| `/admin/launch`                     | `GET`  | No `@Roles` (All staff incl. `READONLY`)           | Infrastructure readiness, mail delivery error diagnostics, DB audit hash chain status    | **HIGH**   | `ADMIN`, `OWNER` only            |
| `/admin/orders`                     | `GET`  | Explicit `[ADMIN, SUPPORT, FULFILLMENT, READONLY]` | Customer emails, customer full names, order total, payment references                    | **HIGH**   | Restrict `READONLY` or mask PII  |
| `/admin/orders/:id`                 | `GET`  | Explicit `[ADMIN, SUPPORT, FULFILLMENT, READONLY]` | Full customer details, internal order notes, notification logs                           | **HIGH**   | Restrict `READONLY` or mask PII  |
| `/admin/customers`                  | `GET`  | Explicit `[ADMIN, SUPPORT, READONLY]`              | Customer list with phone numbers, emails, order frequencies                              | **HIGH**   | `ADMIN`, `SUPPORT` only          |
| `/admin/customers/:id`              | `GET`  | Explicit `[ADMIN, SUPPORT, READONLY]`              | Full customer profile, order history, addresses, phone                                   | **HIGH**   | `ADMIN`, `SUPPORT` only          |
| `/admin/reviews`                    | `GET`  | No `@Roles` (All staff)                            | Customer emails, review text, ratings                                                    | **MEDIUM** | `ADMIN`, `SUPPORT`, `MARKETING`  |
| `/admin/catalog/products/:id/terms` | `GET`  | No `@Roles` (All staff)                            | `costUsd` (cost margins), wholesale metrics, sales volume                                | **HIGH**   | `ADMIN`, `CATALOG` only          |
| `/admin/redirects/404`              | `GET`  | No `@Roles` (All staff)                            | 404 URL paths and HTTP referrers (frequently leak query tokens & session fragments)      | **MEDIUM** | `ADMIN` only; strip query params |
| `/admin/taxonomy/*`                 | `GET`  | No `@Roles` (All staff)                            | Category hierarchy, slugs, display orders                                                | **LOW**    | All staff (Catalog data)         |
| `/admin/locales`                    | `GET`  | No `@Roles` (All staff)                            | Locale configurations and dictionary keys                                                | **LOW**    | All staff (Public/system info)   |
| `/auth/staff/me`                    | `GET`  | No `@Roles` (Self-service)                         | Current authenticated user's own profile, email, role                                    | **LOW**    | `@AnyStaff` (Self profile)       |

---

## 3. Key Findings

1. **Deny-by-Default Needed**: Currently, omission of `@Roles` acts as "allow all". A safer paradigm is either mandatory `@Roles` on all routes or an explicit `@AnyStaff` decorator when a route is intentionally accessible to all staff members.
2. **PII and Revenue Leakage to `READONLY`**: `READONLY` accounts can view gross store revenue, customer email addresses, and phone numbers.
3. **Internal Margin Visibility**: Product terms include `costUsd` (supplier costs), exposing profit margins to non-administrative roles.
4. **404 Referrer Sanitization**: Redirects 404 logs capture raw URLs which may contain query parameters with sensitive tokens.

---

## 4. Corrective Action Items (Follow-up Tasks)

1. **Guard Hardening (L3 Task)**: Update `StaffGuard` to require explicit role definition or an explicit `@AnyStaff` marker. Any route without either will throw `ForbiddenException(403)`.
2. **Dashboard & Launch Restriction (L2 Task)**: Apply `@Roles(StaffRole.ADMIN)` to `DashboardController` and `LaunchController`.
3. **Cost Margin Scoping (L2 Task)**: Restrict product cost fields to `ADMIN` / `CATALOG`.
4. **Referrer Stripping in 404 Logs (L2 Task)**: Sanitize query parameters before logging 404 entries in `RedirectsController`.
