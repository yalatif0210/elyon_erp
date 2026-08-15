import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { authInterceptor } from './core/auth.interceptor';
import { ssrUrlInterceptor } from './core/ssr-url.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideClientHydration(),
    // Ordre significatif : la résolution d'URL doit précéder la pose du
    // jeton, sinon le clone porte l'URL relative que l'intercepteur suivant
    // vient justement de réécrire.
    provideHttpClient(withFetch(), withInterceptors([ssrUrlInterceptor, authInterceptor])),
  ],
};
