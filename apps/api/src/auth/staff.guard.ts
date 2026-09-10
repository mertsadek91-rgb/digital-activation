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

/** Restricts a route to these staff roles. OWNER always passes. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

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
 * Reads the access token from an httpOnly cookie, not an Authorization header.
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

    const claims = await this.auth.verifyAccess(token);
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

    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;
    if (claims.role === 'OWNER' || required.includes(claims.role)) return true;

    throw new ForbiddenException('Your role does not allow this.');
  }
}
