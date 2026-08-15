import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';

let refreshing = false;
const refreshed$ = new BehaviorSubject<string | null>(null);

/**
 * Porte le jeton, et rejoue une fois la requête après rafraîchissement.
 * Miroir de `apps/web/src/app/core/auth.interceptor.ts` — même sérialisation
 * des rafraîchissements concurrents (§ 17).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const isAuthRoute = req.url.includes('/auth/login') || req.url.includes('/auth/refresh');
  const token = auth.accessToken;

  const authorized =
    token && !isAuthRoute ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || isAuthRoute) {
        return throwError(() => error);
      }

      if (!auth.refreshToken) {
        auth.clear();
        return throwError(() => error);
      }

      if (refreshing) {
        return refreshed$.pipe(
          filter((t): t is string => t !== null),
          take(1),
          switchMap((fresh) => next(req.clone({ setHeaders: { Authorization: `Bearer ${fresh}` } }))),
        );
      }

      refreshing = true;
      refreshed$.next(null);

      return auth.refresh().pipe(
        switchMap((res) => {
          refreshing = false;
          refreshed$.next(res.accessToken);
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${res.accessToken}` } }));
        }),
        catchError((refreshError: unknown) => {
          refreshing = false;
          auth.clear();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
