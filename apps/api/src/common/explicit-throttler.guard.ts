import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

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
    const limit = this.reflector.getAllAndOverride<number | undefined>('THROTTLER:LIMITdefault', [
      context.getHandler(),
      context.getClass(),
    ]);
    return Promise.resolve(limit === undefined);
  }
}
