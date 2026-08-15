import { HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';

/**
 * Résout les URL relatives `/api/...` en absolu, UNIQUEMENT côté serveur.
 *
 * `fetch` natif (Node) refuse une URL relative — il n'a pas de notion
 * d'origine courante, contrairement au navigateur. Le rendu SSR de la
 * première visite (tableau de bord, affaires…) échouerait donc silencieusement
 * sans cette résolution. Côté client, l'URL relative reste telle quelle : le
 * serveur Express du portail la relaie déjà vers l'API (§ docker/portal.Dockerfile).
 */
export const ssrUrlInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isPlatformServer(inject(PLATFORM_ID)) || !req.url.startsWith('/api/')) {
    return next(req);
  }
  const base = process.env['API_INTERNAL_URL'] ?? 'http://api:3000';
  return next(req.clone({ url: `${base}${req.url}` }));
};
