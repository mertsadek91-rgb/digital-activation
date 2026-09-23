import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, type HttpAdapterHost } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import type { ErrorContext, ErrorReporter } from '../infra/error-reporter.js';

/**
 * Hands every server fault to the error reporter, then answers exactly as Nest
 * would have.
 *
 * 5xx only. A 404 or a failed coupon is the caller's problem and would drown
 * the faults that are ours. Prisma errors never reach this filter —
 * `PrismaErrorFilter` is registered after it and so is consulted first — and
 * that filter reports its own unmapped 500s.
 */
@Catch()
export class ServerErrorFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly reporter: ErrorReporter,
  ) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      const status = exception instanceof HttpException ? exception.getStatus() : 500;
      const context = errorContext(host, status);
      // The readiness probe's 503 is its answer, not a fault, and it repeats
      // every few seconds for as long as the database is down.
      if (status >= 500 && !context.route?.startsWith('/health')) {
        this.reporter.report(exception, context);
      }
    }
    super.catch(exception, host);
  }
}

export function errorContext(host: ArgumentsHost, status: number): ErrorContext {
  const request = host.switchToHttp().getRequest<FastifyRequest>();
  return {
    status,
    method: request.method,
    route: request.routeOptions?.url,
    // The same id the request log carries and the response header returns.
    requestId: String(request.id),
  };
}
