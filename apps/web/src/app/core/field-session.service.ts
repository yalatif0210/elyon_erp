import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';

/**
 * Rôles du réalm terrain, tels que le serveur les émet dans le jeton.
 *
 * Ils ne sont pas ici pour être affichés mais pour CONDITIONNER l'interface :
 * seul le contrôleur HSE valide une checklist (`@FieldRoles(HSE_CONTROLLER)`
 * sur la route de validation). Un écran qui proposerait le bouton à un agent
 * lui ferait produire un événement voué au refus — et un refus brûle
 * l'identifiant de l'événement.
 */
export type FieldRole = 'FIELD_AGENT' | 'HSE_CONTROLLER';

export interface FieldProfile {
  id: string;
  fullName: string;
  email: string;
  role: FieldRole;
}

interface FieldLoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  mustChangePassword: boolean;
  totpEnrollmentRequired: boolean;
  profile: FieldProfile;
}

const ACCES = 'erp.terrain.acces';
const RAFRAICHI = 'erp.terrain.rafraichi';
const PROFIL = 'erp.terrain.profil';

/**
 * Identifiant de l'APPAREIL — clé de localStorage, et non de sessionStorage.
 *
 * Le contrat de synchronisation exige un `deviceId` sur chaque lot, et le
 * serveur journalise l'écart entre l'appareil présenté et l'appareil assigné
 * à l'agent (§ 10.5). Cet écart n'a de sens que si l'identifiant SURVIT à la
 * fermeture de l'onglet : régénéré à chaque ouverture, il signalerait un
 * changement de tablette à chaque connexion, et le signal deviendrait du bruit.
 *
 * Ce n'est ni un secret ni une donnée d'opération — c'est le nom de la
 * tablette. Le stocker durablement n'entame pas la décision « rien n'est
 * persisté dans le navigateur » qui porte, elle, sur la FILE d'événements.
 */
const APPAREIL = 'erp.terrain.appareil';

/**
 * Session du réalm TERRAIN.
 *
 * Volontairement distincte d'`AuthService` et non dérivée d'elle. Les deux
 * réalms n'ont ni les mêmes routes, ni les mêmes jetons, ni le même périmètre :
 * un jeton terrain présenté sur `/api/internal` est refusé, et réciproquement.
 * Les faire cohabiter dans une seule classe aurait conduit, tôt ou tard, à
 * envoyer l'un là où l'autre est attendu.
 *
 * Les clés de stockage sont préfixées `erp.terrain.` pour la même raison : une
 * déconnexion bureautique ne doit pas fermer la session de la tablette, ni
 * l'inverse.
 */
@Injectable({ providedIn: 'root' })
export class FieldSessionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly profilSignal = signal<FieldProfile | null>(lireProfil());

  readonly profil = this.profilSignal.asReadonly();
  readonly connecte = computed(() => this.profilSignal() !== null);
  readonly role = computed(() => this.profilSignal()?.role ?? null);

  /** Seul le contrôleur HSE valide — la base et le guard serveur le tiennent. */
  readonly estControleurHse = computed(() => this.role() === 'HSE_CONTROLLER');

  /** Mot de passe provisoire : le bandeau doit rester tant que rien n'est fait. */
  readonly motDePasseAChanger = signal(false);

  /**
   * Second facteur exigé mais non configuré (§ 1.4, § 10.5).
   *
   * ⚠️ CORRIGÉ — `totpEnrollmentRequired` ARRIVAIT DANS LA RÉPONSE DE
   *    CONNEXION ET ÉTAIT JETÉ. La console bureautique lit le même champ pour
   *    afficher un bandeau et ouvrir l'enrôlement ; côté terrain, rien ne le
   *    lisait ni la route d'enrôlement (`/api/field/auth/totp/enroll` et
   *    `/confirm`, elles bien vivantes côté serveur) n'avait d'écran pour la
   *    déclencher. Un agent signalé pour un second facteur obligatoire
   *    n'avait aucun moyen de l'activer depuis la tablette.
   */
  readonly totpRequis = signal(false);

  get jeton(): string | null {
    return sessionStorage.getItem(ACCES);
  }

  get jetonRafraichissement(): string | null {
    return sessionStorage.getItem(RAFRAICHI);
  }

  /** Nom de la tablette, créé une fois pour toutes à la première ouverture. */
  get appareil(): string {
    const connu = localStorage.getItem(APPAREIL);
    if (connu) return connu;
    const neuf = `tablette-${nouvelIdentifiant()}`;
    localStorage.setItem(APPAREIL, neuf);
    return neuf;
  }

  connexion(email: string, motDePasse: string, codeTotp?: string): Observable<FieldLoginResponse> {
    return this.http
      .post<FieldLoginResponse>('/api/field/auth/login', {
        email,
        password: motDePasse,
        ...(codeTotp ? { totpCode: codeTotp } : {}),
        // Transmis dès la connexion : c'est là que le serveur constate un
        // changement d'appareil et le journalise.
        deviceId: this.appareil,
      })
      .pipe(tap((res) => this.retenir(res)));
  }

  rafraichir(): Observable<{ accessToken: string; refreshToken: string }> {
    return this.http
      .post<{ accessToken: string; refreshToken: string }>('/api/field/auth/refresh', {
        refreshToken: this.jetonRafraichissement,
      })
      .pipe(
        tap((res) => {
          sessionStorage.setItem(ACCES, res.accessToken);
          sessionStorage.setItem(RAFRAICHI, res.refreshToken);
        }),
      );
  }

  changerMotDePasse(actuel: string, nouveau: string) {
    return this.http
      .patch<{ revokedSessions: number }>('/api/field/auth/password', {
        currentPassword: actuel,
        newPassword: nouveau,
      })
      .pipe(tap(() => this.motDePasseAChanger.set(false)));
  }

  /** Ouvre l'enrôlement et rend le secret — affiché UNE SEULE fois. */
  ouvrirEnrolementTotp(): Observable<{ secret: string }> {
    return this.http.post<{ secret: string }>('/api/field/auth/totp/enroll', {});
  }

  confirmerEnrolementTotp(code: string): Observable<void> {
    return this.http
      .post<void>('/api/field/auth/totp/confirm', { code })
      .pipe(tap(() => this.totpRequis.set(false)));
  }

  deconnexion(): void {
    // On prévient le serveur pour révoquer la session, mais on nettoie
    // localement quoi qu'il arrive : une coupure réseau ne doit pas laisser
    // une tablette connectée entre les mains du suivant.
    this.http.post('/api/field/auth/logout', {}).subscribe({
      next: () => this.vider(),
      error: () => this.vider(),
    });
  }

  vider(): void {
    sessionStorage.removeItem(ACCES);
    sessionStorage.removeItem(RAFRAICHI);
    sessionStorage.removeItem(PROFIL);
    this.profilSignal.set(null);
    void this.router.navigate(['/terrain/connexion']);
  }

  private retenir(res: FieldLoginResponse): void {
    sessionStorage.setItem(ACCES, res.accessToken);
    sessionStorage.setItem(RAFRAICHI, res.refreshToken);
    sessionStorage.setItem(PROFIL, JSON.stringify(res.profile));
    this.profilSignal.set(res.profile);
    this.motDePasseAChanger.set(res.mustChangePassword);
    this.totpRequis.set(res.totpEnrollmentRequired);
  }
}

function lireProfil(): FieldProfile | null {
  const brut = sessionStorage.getItem(PROFIL);
  if (!brut) return null;
  try {
    return JSON.parse(brut) as FieldProfile;
  } catch {
    return null;
  }
}

/**
 * Identifiant unique côté APPAREIL.
 *
 * ⚠️ `crypto.randomUUID` n'existe QUE dans un contexte sécurisé — https, ou
 *    localhost. Une tablette qui ouvre l'application sur `http://10.0.0.12:4200`
 *    n'y a pas accès, et l'appel lèverait à la première mise en file : plus un
 *    seul événement ne partirait, sans que rien ne l'annonce.
 *
 *    On se replie donc sur `getRandomValues`, présent lui hors contexte
 *    sécurisé, en composant un UUID v4 conforme — le serveur le valide par
 *    `@IsUUID()` et refuserait une chaîne de fantaisie.
 */
export function nouvelIdentifiant(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const octets = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(octets);
  } else {
    for (let i = 0; i < 16; i += 1) octets[i] = Math.floor(Math.random() * 256);
  }
  // Version 4 et variante RFC 4122 : sans ces deux marqueurs, la chaîne n'est
  // pas un UUID valide et le serveur la rejette.
  octets[6] = (octets[6] & 0x0f) | 0x40;
  octets[8] = (octets[8] & 0x3f) | 0x80;

  const hex = [...octets].map((o) => o.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
