import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { authInterceptor } from './core/auth.interceptor';
import { fieldAuthInterceptor } from './core/field-auth.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    // Deux intercepteurs, un par réalm, plutôt qu'un seul qui saurait choisir :
    // chacun ne connaît qu'un jeton et ne peut donc pas présenter le mauvais.
    // Celui du bureau laisse passer `/api/field` sans y toucher ; celui du
    // terrain ignore tout le reste. Un intercepteur unique aurait fini par
    // porter le jeton interne sur une route terrain le jour où l'agent et le
    // coordinateur partagent le même navigateur.
    provideHttpClient(withInterceptors([authInterceptor, fieldAuthInterceptor])),
  ],
};
