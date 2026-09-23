import { type ExecutionContext, Injectable, SetMetadata, applyDecorators } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { trackerFor } from './internal-caller.js';

const PER_VISITOR = 'da:throttle-per-visitor';

/**
 * A limit for a route the storefront's server calls on a visitor's behalf.
 *
 * Enforced only when `INTERNAL_API_KEY` is configured, because only then can
 * the API tell visitors apart on these routes; without it every shopper
 * arrives from the storefront's address and a limit would be one limit for
 * the whole shop. See `internal-caller.ts`.
 */
export function VisitorThrottle(limit: number, ttl = 60_000): MethodDecorator & ClassDecorator {
  return applyDecorators(Throttle({ default: { limit, ttl } }), SetMetadata(PER_VISITOR, true));
}

/**
 * Rate limiting, applied where a route asks for it.
 *
 * The `@Throttle` limits on login, TOTP, magic links, coupons, the contact form
 * and key reveals were all decorative: `ThrottlerModule` was configured and no
 * guard was ever registered, so nothing enforced a single one of them.
 *
 * Registered globally, but a route with no `@Throttle` of its own is skipped
 * rather than given the module default. Most of the catalog is fetched by the
 * storefront's Next.js server, so every visitor arrives from the same address;
 * a blanket per-IP limit there would throttle the whole shop as one person.
 * Throttling is a decision made per route, next to the reason for it.
 */
@Injectable()
export class ExplicitThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const limit = this.reflector.getAllAndOverride<number | undefined>(
      'THROTTLER:LIMITdefault',
      targets,
    );
    if (limit === undefined) return Promise.resolve(true);
    const perVisitor = this.reflector.getAllAndOverride<boolean | undefined>(PER_VISITOR, targets);
    return Promise.resolve(perVisitor === true && !process.env.INTERNAL_API_KEY);
  }

  /** The visitor the storefront vouches for, else the connecting address. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the base signature
  protected override getTracker(request: Record<string, any>): Promise<string> {
    return Promise.resolve(
      trackerFor(request as Parameters<typeof trackerFor>[0], process.env.INTERNAL_API_KEY),
    );
  }
}
