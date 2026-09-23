import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@da/db';
import type { FastifyReply } from 'fastify';

import { type ErrorReporter, NoopErrorReporter } from '../infra/error-reporter.js';

import { errorContext } from './server-error.filter.js';

/**
 * The Prisma errors that mean "you asked for something that is not there" or
 * "that already exists", answered as 404 and 409 instead of 500.
 *
 * Without this, a service that forgot to check first — `update` on a row that
 * was deleted a second ago, `create` racing a unique index — reported a server
 * fault, and the admin showed "something went wrong" for what is an ordinary,
 * explainable conflict. The message is generic on purpose: Prisma's own text
 * names tables and columns, which a browser has no business reading.
 *
 * Everything else is rethrown untouched, so Nest's own handling of
 * HttpExceptions and genuine faults is unchanged. An unmapped code is a
 * genuine fault and goes to the error reporter: this filter answers Prisma
 * errors before the catch-all `ServerErrorFilter` sees them, so nobody else
 * would.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorFilter implements ExceptionFilter<Prisma.PrismaClientKnownRequestError> {
  private readonly logger = new Logger(PrismaErrorFilter.name);

  constructor(private readonly reporter: ErrorReporter = new NoopErrorReporter()) {}

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    const mapped = MAPPED[error.code];
    if (!mapped) {
      this.logger.error(`Unhandled Prisma error ${error.code}: ${error.message}`);
      this.reporter.report(error, errorContext(host, HttpStatus.INTERNAL_SERVER_ERROR));
      void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
      return;
    }

    void reply.status(mapped.status).send({ statusCode: mapped.status, message: mapped.message });
  }
}

const MAPPED: Record<string, { status: number; message: string } | undefined> = {
  // Unique constraint.
  P2002: { status: HttpStatus.CONFLICT, message: 'That already exists.' },
  // Foreign key: the thing it points at is gone, or something still points here.
  P2003: {
    status: HttpStatus.CONFLICT,
    message: 'That is still in use, or refers to something missing.',
  },
  // Record required for the operation was not found.
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Not found.' },
};
