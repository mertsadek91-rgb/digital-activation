import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request payload against a zod schema from @da/contracts.
 *
 * Nest's own ValidationPipe is built on class-validator, which would mean a
 * second, parallel definition of every shape the storefront already types
 * against. One definition per shape is the point of the contracts package, so
 * the pipe adapts to zod rather than the schemas adapting to Nest.
 */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  // Public so the OpenAPI document can read the shape a route accepts off the
  // pipe that enforces it (see openapi.ts) — the spec and the validation are
  // then the same object, not two descriptions that drift apart.
  constructor(readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    /*
     * The schema's own words, not "Invalid request".
     *
     * The issues were being sent and the message was not: every panel in this
     * repo reads `message` to put something on screen, so a price refused for
     * being below its own strike-through arrived as "Invalid request" beside a
     * form with fourteen fields in it. The reasons were in the payload the
     * whole time, one key away from being read.
     *
     * `issues` stays, because a client that wants to mark the offending field
     * needs the path; `message` is now the same thing said in one line.
     */
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    throw new BadRequestException({
      // Joined rather than only the first: a form sent with two bad fields is
      // sent back twice if it is corrected one at a time.
      message: issues.map((issue) => issue.message).join(' · ') || 'Invalid request',
      issues,
    });
  }
}
