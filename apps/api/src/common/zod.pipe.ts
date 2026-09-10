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
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      message: 'Invalid request',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}
