import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Stripe and PayPal webhook signatures are computed over the raw body,
      // so it has to survive JSON parsing intact.
      bodyLimit: 2 * 1024 * 1024,
      trustProxy: true,
    }),
    { bufferLogs: true },
  );

  // No global ValidationPipe: it is built on class-validator, which would mean
  // a second definition of every shape @da/contracts already describes in zod.
  // Routes validate with ZodPipe against those same schemas, so there is one
  // definition per shape and the storefront types against it too.

  // The admin holds its session in httpOnly cookies rather than in JavaScript's
  // reach, so the server has to be able to read and set them.
  await app.register(fastifyCookie);

  app.enableCors({
    origin: [process.env.STOREFRONT_URL, process.env.ADMIN_URL].filter(Boolean) as string[],
    credentials: true,
    // @fastify/cors advertises only GET, HEAD and POST unless told otherwise —
    // unlike the Express middleware most examples assume. Left at the default,
    // the browser blocks every PATCH from the admin panel at preflight, so
    // publishing and stock edits fail in the UI while passing from curl.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });

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
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
