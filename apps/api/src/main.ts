import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Amorçage de l'API. Les durcissements posés ici sont ceux qui doivent
 * exister dès le premier jour — les rattraper plus tard coûte toujours plus
 * cher que de partir avec.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Les traces d'erreur ne fuitent jamais côté client en production.
    logger: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : undefined,
  });

  // N'annonce pas la pile technique employée.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // Origines explicitement listées. Aucun joker, y compris en développement.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Tout champ non déclaré est retiré...
      forbidNonWhitelisted: true, // ...et sa présence est une erreur : pas de mass assignment.
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Corps de requête borné : une charge utile démesurée ne doit pas
  // pouvoir saturer la mémoire du conteneur.
  app.useBodyParser('json', { limit: '512kb' });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
