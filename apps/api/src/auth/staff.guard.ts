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

/** Restricts a route to these staff roles. OWNER always passes. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

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

    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;
    if (claims.role === 'OWNER' || required.includes(claims.role)) return true;

    throw new ForbiddenException('Your role does not allow this.');
  }
}
