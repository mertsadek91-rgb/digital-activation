import fastifyCookie from '@fastify/cookie';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { registerPanelLocale } from './common/panel-locale.js';
import { PrismaErrorFilter } from './common/prisma-error.filter.js';
import { ServerErrorFilter } from './common/server-error.filter.js';
import { ERROR_REPORTER, type ErrorReporter } from './infra/error-reporter.js';
import { requestIdFor } from './infra/logging.js';

function trustedHops(): number {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10);
  return Number.isFinite(hops) && hops >= 0 ? hops : 1;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 2 * 1024 * 1024,
      // A hop count, not `true`. `true` believes the whole X-Forwarded-For
      // header, whose left end is whatever the client wrote — so any caller
      // could pick the address the rate limits and the audit log see. One hop
      // is Coolify's proxy; set TRUST_PROXY_HOPS=2 behind a CDN as well.
      trustProxy: (_address: string, hop: number) => hop < trustedHops(),
      // One id per request, shared by Fastify, the request log and the error
      // reporter: a caller's X-Request-Id when it is well-formed, else a UUID.
      // Fastify's own header option would take the header unchecked.
      requestIdHeader: false,
      genReqId: requestIdFor,
    }),
    {
      bufferLogs: true,
      // Webhook signatures are computed over the exact bytes the provider
      // sent, so the raw body has to survive JSON parsing. Without this the
      // Stripe webhook cannot verify anything and every event is rejected —
      // which looks like a Stripe problem and is not one.
      rawBody: true,
    },
  );

  // Every `new Logger(...)` in the code base writes through pino from here on,
  // and what was logged while the modules were being built — buffered by
  // `bufferLogs` above — is flushed through it too.
  const logger = app.get(Logger);
  app.useLogger(logger);

  // No global ValidationPipe: it is built on class-validator, which would mean
  // a second definition of every shape @da/contracts already describes in zod.
  // Routes validate with ZodPipe against those same schemas, so there is one
  // definition per shape and the storefront types against it too.

  // The admin holds its session in httpOnly cookies rather than in JavaScript's
  // reach, so the server has to be able to read and set them.
  await app.register(fastifyCookie);

  // The reader's language, made ambient for the rest of the request. The hook
  // itself lives beside the storage it opens, where it can be tested.
  registerPanelLocale(app.getHttpAdapter().getInstance());

  // No form-body parser is added here: Nest's Fastify adapter already
  // registers one for application/x-www-form-urlencoded, which is what the
  // mailbox provider's RFC 8058 one-click unsubscribe POSTs. Registering a
  // second throws at boot and takes the whole API down with it.

  // Security headers on every response. The API serves JSON, never a page, so
  // the policy is "nothing": no scripts, no frames, no sniffing a JSON body
  // into HTML. Swagger's page needs scripts, and it only exists outside
  // production, so the CSP is production's alone.
  const production = process.env.NODE_ENV === 'production';
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply, payload) => {
      // So a customer's "something went wrong" screenshot can be matched to
      // the log line.
      reply.header('x-request-id', request.id);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('Cross-Origin-Resource-Policy', 'same-site');
      if (production) {
        reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      return payload;
    });

  app.enableCors({
    origin: [process.env.STOREFRONT_URL, process.env.ADMIN_URL].filter(Boolean) as string[],
    credentials: true,
    // @fastify/cors advertises only GET, HEAD and POST unless told otherwise —
    // unlike the Express middleware most examples assume. Left at the default,
    // the browser blocks every PATCH from the admin panel at preflight, so
    // publishing and stock edits fail in the UI while passing from curl.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
    // So the admin can show the id of a failed request, for matching to the log.
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });

  // Nest consults global filters last-registered first, so the Prisma filter
  // sees Prisma errors before the catch-all does. Prisma errors that are the
  // caller's problem are answered as such rather than as a 500 — see the
  // filter for which ones. Every other 5xx goes to the error reporter, which
  // is a no-op unless SENTRY_DSN is set.
  const reporter = app.get<ErrorReporter>(ERROR_REPORTER);
  app.useGlobalFilters(
    new ServerErrorFilter(app.get(HttpAdapterHost), reporter),
    new PrismaErrorFilter(reporter),
  );

  // So a deploy's SIGTERM runs onModuleDestroy — the Prisma pools close and an
  // in-flight request finishes — instead of the process being cut mid-write.
  app.enableShutdownHooks();

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Digital Activation API')
      .setDescription('Storefront and admin API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
  logger.log(`API listening on http://localhost:${port} (docs at /docs)`, 'Bootstrap');
}

void bootstrap();
