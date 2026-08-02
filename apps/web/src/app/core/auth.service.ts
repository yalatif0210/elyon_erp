import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

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
    void this.router.navigate(['/connexion']);
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
