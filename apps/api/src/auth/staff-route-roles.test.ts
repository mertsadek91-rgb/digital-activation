import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  Controller,
  ForbiddenException,
  Get,
  RequestMethod,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '@da/db';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AccessClaims, AuthService } from './auth.service.js';
import {
  AnyStaff,
  Roles,
  StaffGuard,
  StalePasswordOk,
  routeAccess,
  type MetadataTarget,
  type RouteAccess,
  type StaffRequest,
} from './staff.guard.js';

/**
 * TASK-0095. The owner restricted READONLY to catalogue and content reads on
 * 2026-10-02, and StaffGuard now denies any route that names no roles.
 */

// --- the guard ------------------------------------------------------------------

function guardFor(role: StaffRole, mustChange = false) {
  const claims: AccessClaims = { sub: 'staff_1', sid: 's', role, mustChange, totpAt: 0 };
  const auth = { authenticate: () => Promise.resolve(claims) } as unknown as AuthService;
  return new StaffGuard(auth, new Reflector());
}
function contextFor(controller: MetadataTarget, method: string): ExecutionContext {
  const request = { cookies: { da_access: 'token' } } as unknown as StaffRequest;
  const handler = Reflect.get(controller.prototype as object, method) as MetadataTarget;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

@Controller('fixture')
@UseGuards(StaffGuard)
class Unmarked {
  @Get()
  open(): void {}
}

@Controller('fixture')
@UseGuards(StaffGuard)
@Roles('ADMIN')
class Mixed {
  @Get('admin')
  admin(): void {}

  @AnyStaff()
  @Get('any')
  any(): void {}

  @Roles()
  @Get('owner-only')
  ownerOnly(): void {}

  @AnyStaff()
  @StalePasswordOk()
  @Get('me')
  me(): void {}
}

@Controller('fixture')
@UseGuards(StaffGuard)
@AnyStaff()
class OpenClass {
  @Get('read')
  read(): void {}

  @Roles('CATALOG')
  @Get('cost')
  cost(): void {}
}

describe('StaffGuard denies by default', () => {
  const pass = (role: StaffRole, controller: MetadataTarget, method: string, mustChange = false) =>
    guardFor(role, mustChange).canActivate(contextFor(controller, method));

  it('refuses a route with neither @Roles nor @AnyStaff to every role but OWNER', async () => {
    for (const role of [
      'ADMIN',
      'SUPPORT',
      'FULFILLMENT',
      'CATALOG',
      'MARKETING',
      'READONLY',
    ] as const)
      await expect(pass(role, Unmarked, 'open')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(pass('OWNER', Unmarked, 'open')).resolves.toBe(true);
  });

  it('lets OWNER through any role list, including an empty one', async () => {
    await expect(pass('OWNER', Mixed, 'admin')).resolves.toBe(true);
    await expect(pass('OWNER', Mixed, 'ownerOnly')).resolves.toBe(true);
    await expect(pass('ADMIN', Mixed, 'ownerOnly')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a method mark beats the controller mark, in both directions', async () => {
    await expect(pass('READONLY', Mixed, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(pass('ADMIN', Mixed, 'admin')).resolves.toBe(true);
    await expect(pass('READONLY', Mixed, 'any')).resolves.toBe(true);
    await expect(pass('READONLY', OpenClass, 'read')).resolves.toBe(true);
    await expect(pass('READONLY', OpenClass, 'cost')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(pass('CATALOG', OpenClass, 'cost')).resolves.toBe(true);
  });

  it('@AnyStaff does not let a generated password past, @StalePasswordOk does', async () => {
    await expect(pass('READONLY', Mixed, 'any', true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(pass('READONLY', Mixed, 'me', true)).resolves.toBe(true);
  });
});

// --- every real route -------------------------------------------------------------

interface Route {
  key: string;
  access: RouteAccess;
}

const SRC = join(__dirname, '..');

function controllerFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.controller.ts'))
    .map((file) => join(SRC, file));
}

const joinPath = (...parts: (string | undefined)[]) =>
  parts
    .flatMap((part) => (part ?? '').split('/'))
    .filter(Boolean)
    .join('/');

/** Every route on every controller that StaffGuard sits in front of. */
async function staffRoutes(): Promise<Route[]> {
  const reflector = new Reflector();
  const routes: Route[] = [];
  for (const file of controllerFiles()) {
    const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(exports)) {
      if (typeof value !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, value) as string | undefined;
      if (base === undefined) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, value) ?? []) as unknown[];
      const proto = value.prototype as object;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = Reflect.get(proto, name) as unknown;
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
        if (!classGuards.includes(StaffGuard) && !guards.includes(StaffGuard)) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        routes.push({
          key: `${RequestMethod[method]} /${joinPath(base, path)}`,
          access: routeAccess(reflector, handler, value),
        });
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

const allows = (access: RouteAccess | undefined, role: StaffRole) =>
  role === 'OWNER' ||
  access?.kind === 'any-staff' ||
  (access?.kind === 'roles' && access.roles.includes(role));

describe('every StaffGuard route declares who may use it', () => {
  let routes: Route[] = [];
  const of = (key: string) => routes.find((route) => route.key === key)?.access;

  beforeAll(async () => {
    routes = await staffRoutes();
  }, 60_000);

  it('finds the staff routes at all', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('no route is left with neither @Roles nor @AnyStaff', () => {
    expect(routes.filter((route) => route.access.kind === 'unmarked').map((r) => r.key)).toEqual(
      [],
    );
  });

  it('READONLY reaches exactly the catalogue, content and self-service reads', () => {
    expect(routes.filter((route) => allows(route.access, 'READONLY')).map((r) => r.key)).toEqual([
      'GET /admin/categories',
      'GET /admin/locales',
      'GET /admin/products',
      'GET /admin/products/:slug',
      'GET /admin/products/:slug/activation-steps',
      'GET /admin/products/:slug/content',
      'GET /admin/products/:slug/identity',
      'GET /admin/products/:slug/images',
      'GET /admin/products/:slug/links',
      'GET /admin/products/:slug/readiness',
      'GET /admin/redirects',
      'GET /auth/staff/me',
      'POST /auth/staff/password',
      'POST /auth/staff/step-up',
    ]);
  });

  it('applies the owner decision of 2026-10-02 route by route', () => {
    const roles = (key: string) => {
      const access = of(key);
      return access?.kind === 'roles' ? [...access.roles] : access?.kind;
    };
    expect(roles('GET /admin/orders')).toEqual(['OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT']);
    expect(roles('GET /admin/orders/:number')).toEqual([
      'OWNER',
      'ADMIN',
      'SUPPORT',
      'FULFILLMENT',
    ]);
    expect(roles('GET /admin/customers')).toEqual(['OWNER', 'ADMIN', 'SUPPORT']);
    expect(roles('GET /admin/customers/:id')).toEqual(['OWNER', 'ADMIN', 'SUPPORT']);
    expect(roles('GET /admin/reviews')).toEqual(['ADMIN', 'SUPPORT', 'MARKETING']);
    expect(roles('GET /admin/dashboard')).toEqual(['OWNER', 'ADMIN']);
    expect(roles('GET /admin/launch')).toEqual(['OWNER', 'ADMIN']);
    expect(roles('GET /admin/products/:slug/terms')).toEqual(['OWNER', 'ADMIN', 'CATALOG']);
  });
});
