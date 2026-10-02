import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { StaffRole } from '@da/db';

import { AuthService, type AccessClaims } from './auth.service.js';

export const ROLES_KEY = 'da:roles';
export const STALE_PASSWORD_OK_KEY = 'da:stalePasswordOk';
export const ANY_STAFF_KEY = 'da:anyStaff';

/** Restricts a route to these staff roles. OWNER always passes. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Opens a route to every signed-in staff role, READONLY included (TASK-0095).
 *
 * StaffGuard denies by default: a route with neither `@Roles` nor this marker
 * is refused to everyone but OWNER, so forgetting a decorator closes a route
 * rather than opening it. Use this only for self-service routes and for
 * low-sensitivity catalogue and content reads.
 */
export const AnyStaff = () => SetMetadata(ANY_STAFF_KEY, true);

/** A route handler or controller class, as Nest's Reflector takes it. */
export type MetadataTarget = Parameters<Reflector['get']>[1];

/** What a route asks of the caller's role, nearest declaration first. */
export type RouteAccess =
  { kind: 'roles'; roles: readonly StaffRole[] } | { kind: 'any-staff' } | { kind: 'unmarked' };

/**
 * Resolves a route's access rule. A method's own `@Roles` or `@AnyStaff` beats
 * the controller's; `@Roles` beats `@AnyStaff` at the same level, so the
 * stricter of two conflicting marks wins.
 */
export function routeAccess(
  reflector: Reflector,
  handler: MetadataTarget,
  controller: MetadataTarget,
): RouteAccess {
  for (const target of [handler, controller]) {
    const roles = reflector.get<StaffRole[] | undefined>(ROLES_KEY, target);
    if (roles) return { kind: 'roles', roles };
    if (reflector.get<boolean | undefined>(ANY_STAFF_KEY, target) === true)
      return { kind: 'any-staff' };
  }
  return { kind: 'unmarked' };
}

/**
 * Marks the few routes an account still on its generated password may reach:
 * reading who it is, changing the password, and signing out. Everything else
 * is refused until the owner has set a password of their own.
 */
export const StalePasswordOk = () => SetMetadata(STALE_PASSWORD_OK_KEY, true);

export interface StaffRequest extends FastifyRequest {
  staff?: AccessClaims;
}

/**
 * Reads the access token from an httpOnly cookie, not an Authorization header,
 * and checks on every request that its session is still live.
 *
 * The admin is a browser application, and a token in JavaScript's reach is a
 * token an injected script can read. httpOnly plus SameSite=strict costs a
 * little convenience for a class of attack removed.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const token = request.cookies?.da_access;

    if (!token) throw new UnauthorizedException('Sign in to continue.');

    // Signature, then a live-session lookup: revoked, expired or deactivated
    // is a 401 on this request, not when the token runs out (BUG-0005).
    const claims = await this.auth.authenticate(token);
    request.staff = claims;

    // Before role, before anything. A password that was printed to a terminal
    // is an enrolment token, not a credential, and OWNER is no exception —
    // OWNER is precisely the account that can read a licence key.
    if (claims.mustChange) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(STALE_PASSWORD_OK_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (allowed !== true) {
        throw new ForbiddenException(
          'Set a password of your own before using the panel. The one you signed in with was generated and printed.',
        );
      }
    }

    // Deny by default (TASK-0095): no `@Roles` and no `@AnyStaff` is a route
    // nobody decided on, and it stays closed to everyone but OWNER.
    if (claims.role === 'OWNER') return true;
    const access = routeAccess(this.reflector, context.getHandler(), context.getClass());
    if (access.kind === 'any-staff') return true;
    if (access.kind === 'roles' && access.roles.includes(claims.role)) return true;

    throw new ForbiddenException('Your role does not allow this.');
  }
}
