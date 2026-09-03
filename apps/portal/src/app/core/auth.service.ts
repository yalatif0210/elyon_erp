import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

export interface PortalProfile {
  id: string;
  fullName: string;
  email: string;
  partnerId: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mustChangePassword: boolean;
  totpEnrollmentRequired: boolean;
  profile: PortalProfile;
}

/**
 * Session du portail client.
 *
 * Jetons en sessionStorage, comme la console interne (apps/web) — mêmes
 * raisons (§ 17, `auth.service.ts`). Ce service tourne aussi côté serveur
 * (rendu SSR) : `sessionStorage` n'y existe pas, d'où la garde
 * `isPlatformBrowser` sur chaque accès. Une première visite server-rendue
 * s'y voit donc toujours anonyme — sans conséquence hors du premier rendu,
 * la navigation ultérieure est côté client, là où le stockage existe.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private static readonly ACCESS = 'portal.access';
  private static readonly REFRESH = 'portal.refresh';
  private static readonly PROFILE = 'portal.profile';

  private readonly profileSignal = signal<PortalProfile | null>(this.readProfile());

  readonly profile = this.profileSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.profileSignal() !== null);

  readonly passwordChangePending = signal(false);

  get accessToken(): string | null {
    if (!this.isBrowser) return null;
    return sessionStorage.getItem(AuthService.ACCESS);
  }

  get refreshToken(): string | null {
    if (!this.isBrowser) return null;
    return sessionStorage.getItem(AuthService.REFRESH);
  }

  login(email: string, password: string, totpCode?: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/portal/auth/login', { email, password, totpCode })
      .pipe(tap((res) => this.persist(res)));
  }

  refresh(): Observable<{ accessToken: string; refreshToken: string }> {
    return this.http
      .post<{ accessToken: string; refreshToken: string }>('/api/portal/auth/refresh', {
        refreshToken: this.refreshToken,
      })
      .pipe(
        tap((res) => {
          if (!this.isBrowser) return;
          sessionStorage.setItem(AuthService.ACCESS, res.accessToken);
          sessionStorage.setItem(AuthService.REFRESH, res.refreshToken);
        }),
      );
  }

  logout(): void {
    this.http.post('/api/portal/auth/logout', {}).subscribe({
      next: () => this.clear(),
      error: () => this.clear(),
    });
  }

  clear(): void {
    if (this.isBrowser) {
      sessionStorage.removeItem(AuthService.ACCESS);
      sessionStorage.removeItem(AuthService.REFRESH);
      sessionStorage.removeItem(AuthService.PROFILE);
    }
    this.profileSignal.set(null);
    void this.router.navigate(['/connexion']);
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.http
      .patch<{ revokedSessions: number }>('/api/portal/auth/password', {
        currentPassword,
        newPassword,
      })
      .pipe(tap(() => this.passwordChangePending.set(false)));
  }

  /**
   * Second facteur — STRICTEMENT VOLONTAIRE dans ce Royaume (ticket #8).
   * `totpEnabled` n'est jamais mis en cache ici : `me()` l'interroge à
   * chaque appel, l'écran de compte décide quand le relire.
   */
  me(): Observable<{ totpEnabled: boolean }> {
    return this.http.get<{ totpEnabled: boolean }>('/api/portal/auth/me');
  }

  /** Ouvre l'enrôlement et rend le secret — affiché UNE SEULE fois. */
  beginTotpEnrollment() {
    return this.http.post<{ secret: string; otpauthUrl: string }>(
      '/api/portal/auth/totp/enroll',
      {},
    );
  }

  confirmTotpEnrollment(code: string) {
    return this.http.post<void>('/api/portal/auth/totp/confirm', { code });
  }

  /** Exige le code courant — une session volée ne doit pas pouvoir l'affaiblir seule. */
  disableTotp(code: string) {
    return this.http.delete<void>('/api/portal/auth/totp', { body: { code } });
  }

  private persist(res: LoginResponse): void {
    if (this.isBrowser) {
      sessionStorage.setItem(AuthService.ACCESS, res.accessToken);
      sessionStorage.setItem(AuthService.REFRESH, res.refreshToken);
      sessionStorage.setItem(AuthService.PROFILE, JSON.stringify(res.profile));
    }
    this.profileSignal.set(res.profile);
    this.passwordChangePending.set(res.mustChangePassword);
  }

  private readProfile(): PortalProfile | null {
    if (!this.isBrowser) return null;
    const raw = sessionStorage.getItem(AuthService.PROFILE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PortalProfile;
    } catch {
      return null;
    }
  }
}
