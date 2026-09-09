import { ValidationPipe } from '@nestjs/common';
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

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown properties rather than silently dropping them: a typo in
      // a price or discount field must fail loudly.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: [process.env.STOREFRONT_URL, process.env.ADMIN_URL].filter(Boolean) as string[],
    credentials: true,
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
