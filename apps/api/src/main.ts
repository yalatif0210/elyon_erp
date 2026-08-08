import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * `JSON.stringify` lève sur un BigInt — et le schéma en porte quatre
 * (taille des fichiers, identifiant du journal d'audit). Sans cette
 * déclaration, toute route renvoyant un document répond 500.
 *
 * La taille est rendue en CHAÎNE, jamais en nombre : au-delà de 2^53 un
 * `number` JavaScript perd des unités, et une empreinte de fichier fausse
 * vaut moins que pas d'empreinte du tout.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
  this: bigint,
): string {
  return this.toString();
};

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

  /**
   * UN SEUL saut de confiance : notre nginx, seul chemin d'accès à l'API.
   *
   * Sans cela, `req.ip` vaut l'adresse du conteneur nginx pour TOUT LE MONDE.
   * Deux conséquences, toutes deux graves :
   *   — la limitation de débit devient collective. Les 5 tentatives de
   *     connexion par minute sont partagées par toute l'entreprise, et un seul
   *     utilisateur qui se trompe verrouille les autres ;
   *   — le journal d'audit enregistre l'adresse du proxy sur chaque écriture.
   *     Un audit qui répond « c'est nginx » à la question « qui ? » ne sert à
   *     rien le jour où on en a besoin.
   *
   * Le chiffre 1 est essentiel : il fait confiance au dernier saut seulement.
   * `true` laisserait un client forger sa propre adresse via X-Forwarded-For.
   */
  app.set('trust proxy', 1);

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
