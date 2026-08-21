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
   * DEUX sauts de confiance, ni plus ni moins : le relais public (`proxy`,
   * docker/nginx/proxy.conf) PUIS le nginx de `web` (docker/nginx/web.conf,
   * qui relaie /api/ en interne) — jamais un accès direct à l'API.
   *
   * Sans ce réglage exact, `req.ip` vaut l'adresse du CONTENEUR qui a fait le
   * dernier saut pour TOUT LE MONDE. Constaté en direct : avec `1` (un seul
   * saut), l'adresse consignée était celle du conteneur `web` reçue par
   * `api` — pas celle du relais public, encore moins celle du visiteur. Deux
   * conséquences, toutes deux graves :
   *   — la limitation de débit devient collective. Les 5 tentatives de
   *     connexion par minute sont partagées par toute l'entreprise, et un seul
   *     utilisateur qui se trompe verrouille les autres ;
   *   — le journal d'audit enregistre l'adresse d'un conteneur sur chaque
   *     écriture. Un audit qui répond « c'est docker » à la question « qui ? »
   *     ne sert à rien le jour où on en a besoin — constaté en direct sur des
   *     tentatives de connexion échouées, toutes journalisées sous la même
   *     adresse interne `172.19.0.x`.
   *
   * Le chiffre 2 est essentiel : il fait confiance aux deux derniers sauts
   * SEULEMENT. `true` laisserait un client forger sa propre adresse via
   * X-Forwarded-For.
   */
  app.set('trust proxy', 2);

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
