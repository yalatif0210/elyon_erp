import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, shareReplay, tap } from 'rxjs';

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export type UserRole =
  | 'DG'
  | 'ASSISTANT_DG'
  | 'IT_ADMIN'
  | 'CCOO'
  | 'SALES_REP'
  | 'LOGISTICS_COORD'
  | 'FINANCE_CFO'
  | 'ACCOUNTANT';

export const ROLE_LABELS: Record<UserRole, string> = {
  DG: 'Directeur Général',
  ASSISTANT_DG: 'Assistante de Direction',
  IT_ADMIN: 'Ingénieur Informatique',
  CCOO: 'Directeur Commercial & Opérations',
  SALES_REP: 'Chargé de Clientèle & Devis',
  LOGISTICS_COORD: 'Coordinateur Logistique & Sourcing',
  FINANCE_CFO: 'Directeur Financier',
  ACCOUNTANT: 'Comptable / Recouvrement',
};

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mustChangePassword: boolean;
  totpEnrollmentRequired: boolean;
  profile: Profile;
}

/**
 * Session de la console interne.
 *
 * Les jetons vivent en sessionStorage et non en localStorage : ils disparaissent
 * à la fermeture de l'onglet, ce qui limite la fenêtre d'exploitation sur un
 * poste partagé. Un stockage en cookie httpOnly serait plus sûr encore, mais
 * suppose un même domaine pour l'API — à revoir au moment du déploiement.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private static readonly ACCESS = 'erp.access';
  private static readonly REFRESH = 'erp.refresh';
  private static readonly PROFILE = 'erp.profile';

  private readonly profileSignal = signal<Profile | null>(readProfile());

  readonly profile = this.profileSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.profileSignal() !== null);
  readonly role = computed(() => this.profileSignal()?.role ?? null);

  /** Vrai quand le compte doit encore enrôler son second facteur (§ 1.4). */
  readonly totpPending = signal(false);
  readonly passwordChangePending = signal(false);

  /**
   * Écrans visibles pour le rôle courant, dérogations DG comprises
   * (§ paramétrage 17/08).
   *
   * `null` tant que non chargé - le menu et les gardes de route attendent
   * `visibleScreens$()` plutôt que de lire ce signal directement, pour ne
   * jamais décider sur un ensemble vide par manque de chargement.
   */
  private readonly screensSignal = signal<string[] | null>(null);
  readonly screens = this.screensSignal.asReadonly();
  private screens$: Observable<string[]> | null = null;

  /** Charge une fois par session, partagé entre le menu et les gardes de route. */
  visibleScreens$(): Observable<string[]> {
    if (!this.screens$) {
      this.screens$ = this.http.get<{ screens: string[] }>('/api/internal/screen-access/me').pipe(
        map((r) => r.screens),
        tap((screens) => this.screensSignal.set(screens)),
        shareReplay(1),
      );
    }
    return this.screens$;
  }

  /** Lecture synchrone pour le menu - vide tant que non chargé, jamais faussement permissif. */
  canSeeScreen(key: string): boolean {
    return this.screensSignal()?.includes(key) ?? false;
  }

  get accessToken(): string | null {
    return sessionStorage.getItem(AuthService.ACCESS);
  }

  get refreshToken(): string | null {
    return sessionStorage.getItem(AuthService.REFRESH);
  }

  login(email: string, password: string, totpCode?: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/internal/auth/login', {
        email,
        password,
        ...(totpCode ? { totpCode } : {}),
      })
      .pipe(tap((res) => this.persist(res)));
  }

  refresh(): Observable<{ accessToken: string; refreshToken: string }> {
    return this.http
      .post<{ accessToken: string; refreshToken: string }>('/api/internal/auth/refresh', {
        refreshToken: this.refreshToken,
      })
      .pipe(
        tap((res) => {
          sessionStorage.setItem(AuthService.ACCESS, res.accessToken);
          sessionStorage.setItem(AuthService.REFRESH, res.refreshToken);
        }),
      );
  }

  logout(): void {
    // On informe le serveur pour révoquer la session côté Redis, mais on nettoie
    // localement quoi qu'il arrive : une erreur réseau ne doit pas laisser un
    // poste connecté.
    this.http.post('/api/internal/auth/logout', {}).subscribe({
      next: () => this.clear(),
      error: () => this.clear(),
    });
  }

  clear(): void {
    sessionStorage.removeItem(AuthService.ACCESS);
    sessionStorage.removeItem(AuthService.REFRESH);
    sessionStorage.removeItem(AuthService.PROFILE);
    this.profileSignal.set(null);
    this.screensSignal.set(null);
    this.screens$ = null;
    void this.router.navigate(['/connexion']);
  }

  /**
   * Changement de mot de passe. Les indicateurs d'obligation retombent au
   * succès : le bandeau doit disparaître au moment où l'action est faite,
   * sans exiger une reconnexion.
   */
  changePassword(currentPassword: string, newPassword: string) {
    return this.http
      .patch<{ revokedSessions: number }>('/api/internal/auth/password', {
        currentPassword,
        newPassword,
      })
      .pipe(tap(() => this.passwordChangePending.set(false)));
  }

  /** Ouvre l'enrôlement et rend le secret — affiché UNE SEULE fois. */
  beginTotpEnrollment() {
    return this.http.post<{ secret: string }>('/api/internal/auth/totp/enroll', {});
  }

  confirmTotpEnrollment(code: string) {
    return this.http
      .post<void>('/api/internal/auth/totp/confirm', { code })
      .pipe(tap(() => this.totpPending.set(false)));
  }

  /** Le rôle figure-t-il parmi ceux autorisés ? Miroir du guard serveur. */
  hasRole(...roles: UserRole[]): boolean {
    const current = this.role();
    return current !== null && roles.includes(current);
  }

  private persist(res: LoginResponse): void {
    sessionStorage.setItem(AuthService.ACCESS, res.accessToken);
    sessionStorage.setItem(AuthService.REFRESH, res.refreshToken);
    sessionStorage.setItem(AuthService.PROFILE, JSON.stringify(res.profile));
    this.profileSignal.set(res.profile);
    this.totpPending.set(res.totpEnrollmentRequired);
    this.passwordChangePending.set(res.mustChangePassword);
    // Une nouvelle connexion dans le même onglet ne doit jamais réutiliser les
    // écrans du compte précédent : sans cette remise à zéro, `visibleScreens$()`
    // aurait rendu son résultat mis en cache par `shareReplay`.
    this.screensSignal.set(null);
    this.screens$ = null;
  }
}

function readProfile(): Profile | null {
  const raw = sessionStorage.getItem('erp.profile');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}
