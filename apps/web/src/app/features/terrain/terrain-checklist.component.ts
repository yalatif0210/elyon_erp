import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  FieldApiService,
  FieldCheck,
  FieldCheckItem,
  NIVEAU_BLOQUANT,
} from '../../core/field-api.service';
import { DepotEvenement, FieldQueueService } from '../../core/field-queue.service';
import { FieldPhotoService, NaturePiece } from '../../core/field-photo.service';
import { FieldSessionService } from '../../core/field-session.service';
import { IconComponent } from '../../shared/icon.component';
import { deposer, messageServeur } from './terrain-depot';
import {
  NIVEAU_CONTROLE,
  RESULTAT_ENREGISTRE,
  RESULTATS_POINT,
  ResultatPoint,
  jourHeure,
} from './terrain-libelles';

/**
 * CHECKLIST HSE — le cœur du travail de terrain.
 *
 * ⚠️ RENSEIGNER N'EST PAS VALIDER.
 *
 *    L'agent RENSEIGNE chaque point ; seul le contrôleur HSE VALIDE la
 *    checklist, et la base lui refuse de valider celle dont il a lui-même
 *    renseigné un point bloquant. C'est la séparation des tâches sur laquelle
 *    repose le verrou HSE tout entier.
 *
 *    L'interface ne doit jamais laisser croire le contraire. Concrètement :
 *    le bouton de validation n'existe pas pour un agent, et il est refusé —
 *    avec le motif écrit à l'avance — au contrôleur qui a renseigné un point
 *    bloquant. Le laisser cliquer produirait un événement voué au refus, et
 *    UN REFUS BRÛLE L'IDENTIFIANT : le travail serait à refaire.
 *
 * Chaque geste produit un événement mis en file. L'écran ne modifie jamais
 * l'état affiché de sa propre initiative : il recharge depuis l'API une fois
 * l'événement acquis. Ce que montre la tablette est alors ce que la base a
 * réellement retenu, et non ce que l'agent croit avoir fait.
 */
@Component({
  selector: 'terrain-checklist',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="t-screen">
      <a
        [routerLink]="['/terrain/operation', id]"
        class="inline-flex min-h-[52px] items-center gap-1.5 text-[15px] font-semibold text-primary"
      >
        <erp-icon name="arrow-right" [size]="17" class="rotate-180" />
        Dossier de l’opération
      </a>

      <!-- ================= Compte rendu ================= -->
      @if (erreur()) {
        <div
          class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash px-3.5 py-3 text-[15px]
                 leading-relaxed text-crit"
          role="alert"
        >
          <p class="flex items-start gap-2 font-semibold">
            <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
            Refusé
          </p>
          <p class="mt-1.5 whitespace-pre-line">{{ erreur() }}</p>
          <p class="mt-2 text-[14px]">
            Ce refus est définitif pour cet enregistrement. Levez la cause, puis refaites
            l’action : elle produira un enregistrement neuf.
          </p>
        </div>
      }
      @if (info()) {
        <p
          class="mt-3 flex items-start gap-2 rounded-[3px] border border-ok/30 bg-ok-wash px-3.5
                 py-3 text-[15px] leading-relaxed text-ok"
          role="status"
        >
          <erp-icon name="check-circle" [size]="18" class="mt-0.5" />
          <span>{{ info() }}</span>
        </p>
      }
      @if (file.erreurTransport(); as panne) {
        <p class="mt-3 rounded-[3px] border border-warn/50 bg-warn-wash px-3.5 py-3 text-[15px] text-warn-ink">
          {{ panne }}
        </p>
      }

      <!-- ⚠️ CORRIGÉ (§ 25/08/2026) — cet écran demandait la phase à l'agent.
           Elle se choisit désormais depuis l'accordéon des étapes du
           dossier, qui la connaît déjà et ouvre la checklist directement :
           ce cas ne s'atteint plus par un lien normal, seul un ancien signet
           peut encore y mener. -->
      @if (!checkId) {
        <h1 class="t-title mt-2">Ouvrir une checklist</h1>
        <p class="t-sub">
          Les checklists s’ouvrent depuis le dossier de l’opération, étape par étape : il connaît
          déjà l’ordre, vous n’avez rien à choisir ici.
        </p>
        <a class="t-btn-primary mt-3" [routerLink]="['/terrain/operation', id]">
          Revenir au dossier de l’opération
        </a>
      }

      <!-- ================= Points de contrôle ================= -->
      @if (checkId && checklist(); as c) {
        <h1 class="t-title mt-2">Checklist <span class="t-code text-[18px]">{{ c.phase }}</span></h1>
        <p class="t-sub">
          {{ renseignes(c) }} / {{ c.items.length }} points renseignés
          @if (c.template) { · modèle {{ c.template.code }} v{{ c.template.version }} }
        </p>

        @if (c.validatedAt) {
          <p class="mt-3 flex items-center gap-2 rounded-[3px] border border-ok/40 bg-ok-wash px-3.5 py-3 text-[15px] font-semibold text-ok">
            <erp-icon name="check-circle" [size]="18" />
            Validée le {{ dateHeureDe(c.validatedAt) }}
            @if (c.validatedByFieldUser) { par {{ c.validatedByFieldUser.fullName }} }
            @if (c.validatedByUser) { par {{ c.validatedByUser.fullName }} (suppléance) }
          </p>
          <p class="t-hint">
            Une checklist validée ne se modifie plus. Si un écart apparaît maintenant, déclarez
            un incident depuis le dossier de l’opération.
          </p>
        } @else if (c.rejectedAt) {
          <p class="mt-3 flex items-start gap-2 rounded-[3px] border border-crit/30 bg-crit-wash px-3.5 py-3 text-[15px] leading-relaxed text-crit">
            <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
            <span>
              <span class="font-semibold">
                Rejetée le {{ dateHeureDe(c.rejectedAt) }}
                @if (c.rejectedByFieldUser) { par {{ c.rejectedByFieldUser.fullName }} }
                @if (c.rejectedByUser) { par {{ c.rejectedByUser.fullName }} (suppléance) }
              </span>
              <span class="mt-1 block">{{ c.rejectionReason }}</span>
            </span>
          </p>
          <p class="t-hint">
            Reprenez les points concernés ci-dessous, puis soumettez à nouveau la validation.
          </p>
        }

        @for (pt of c.items; track pt.id) {
          <div
            class="mt-3 rounded-[3px] border border-rule-strong bg-surface p-4"
            [class.t-blocking]="bloquant(pt)"
          >
            <div class="flex items-start justify-between gap-3">
              <p class="text-[17px] font-semibold leading-snug text-ink">{{ pt.item.label }}</p>
              <span class="t-code shrink-0">{{ pt.item.code }}</span>
            </div>

            <!-- Le niveau est affiché tel que le serveur le rend. Seul le
                 niveau bloquant reçoit un traitement visuel : c'est lui, et lui
                 seul, qui empêche l'opération d'avancer. -->
            <p class="mt-1.5">
              <span
                class="inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5"
                [class]="bloquant(pt) ? 'bg-crit text-white' : 'bg-gray-100'"
              >
                @if (bloquant(pt)) { <erp-icon name="lock" [size]="14" /> }
                <span class="t-code" [class.text-white]="bloquant(pt)">{{ niveauLabel(pt.level) }}</span>
              </span>
            </p>

            @if (pt.item.guidance) {
              <p class="mt-2 text-[15px] leading-relaxed text-ink-soft">{{ pt.item.guidance }}</p>
            }

            <!-- État courant, tel qu'il est EN BASE. -->
            <p class="mt-2 text-[15px]">
              <span class="text-ink-muted">Enregistré :</span>
              <span class="t-code ml-1">{{ outcomeLabel(pt.outcome) }}</span>
              @if (pt.recordedByFieldUser) {
                <span class="text-ink-muted"> · {{ pt.recordedByFieldUser.fullName }}</span>
              }
              @if (pt.recordedAt) {
                <span class="text-ink-muted"> · {{ dateHeureDe(pt.recordedAt) }}</span>
              }
            </p>
            @if (pt.recordedValue) {
              <p class="text-[15px] text-ink-soft">Valeur : {{ pt.recordedValue }}</p>
            }
            @if (pt.comment) {
              <p class="text-[15px] text-ink-soft">Commentaire : {{ pt.comment }}</p>
            }

            <!-- ================= Pièces déjà en base (§ 25/08/2026) =================
                 Le contrôleur HSE valide à distance, sur pièces (§ 7.2) : sans cet
                 affichage, il n'avait rien à examiner, seulement le compte rendu
                 écrit. Visible de tous, agent compris, qui y retrouve ses propres
                 clichés une fois envoyés. -->
            @if (photosEnBase(pt); as pieces) {
              @if (pieces.length > 0) {
                <div class="mt-2 flex flex-wrap gap-2">
                  @for (a of pieces; track a.id) {
                    <figure class="w-[104px]">
                      @if (urlPiece(a.id); as src) {
                        <!-- ⚠️ CORRIGÉ (§ 25/08/2026) — l'ouverture plein écran
                             prend un lien blob:, PAS le même data: que l'aperçu :
                             Chrome refuse la navigation de premier niveau vers
                             data: (page blanche silencieuse), alors qu'il
                             l'accepte sans réserve vers blob:. -->
                        <a [href]="urlOuverture(a.id)" target="_blank" rel="noopener">
                          <img
                            [src]="src"
                            alt="Photo jointe au contrôle"
                            class="h-[104px] w-[104px] rounded-[3px] border border-rule-strong object-cover"
                          />
                        </a>
                      } @else {
                        <div class="flex h-[104px] w-[104px] items-center justify-center rounded-[3px] border border-rule-strong bg-gray-100 text-[12px] text-ink-faint">
                          Chargement…
                        </div>
                      }
                      @if (a.caption) {
                        <figcaption class="mt-1 text-[12px] leading-tight text-ink-soft">{{ a.caption }}</figcaption>
                      }
                    </figure>
                  }
                </div>
              }
            }

            @if (!c.validatedAt && !estControleur()) {
              <!-- Trois boutons pleine largeur plutôt qu'une liste déroulante :
                   c'est le geste le plus répété de la journée, et il doit se
                   faire d'un pouce, avec des gants. -->
              <div class="mt-3 flex gap-2">
                @for (r of resultats; track r.code) {
                  <button
                    type="button"
                    [class]="classeChoix(pt.id, r)"
                    [attr.aria-pressed]="saisie(pt.id).outcome === r.code"
                    (click)="choisir(pt.id, r.code)"
                  >
                    {{ r.libelle }}
                  </button>
                }
              </div>

              @if (pt.item.requiresValue) {
                <div class="mt-3">
                  <label class="t-label" [attr.for]="'valeur-' + pt.id">
                    {{ pt.item.valueLabel ?? 'Valeur relevée' }}, exigée
                  </label>
                  <input
                    [id]="'valeur-' + pt.id"
                    class="t-field"
                    maxlength="500"
                    [ngModel]="saisie(pt.id).recordedValue"
                    (ngModelChange)="majValeur(pt.id, $event)"
                  />
                </div>
              }

              <div class="mt-3">
                <label class="t-label" [attr.for]="'note-' + pt.id">Commentaire</label>
                <textarea
                  [id]="'note-' + pt.id"
                  class="t-field"
                  maxlength="1000"
                  [ngModel]="saisie(pt.id).comment"
                  (ngModelChange)="majCommentaire(pt.id, $event)"
                ></textarea>
              </div>

              <!-- ================= Photos =================
                   La prise de vue est proposée sur TOUS les points, pas
                   seulement ceux qui l'exigent : un constat imprévu — une
                   fuite, un accès impraticable — se photographie là où il se
                   trouve, et l'agent n'a pas à se demander si le paramétrage
                   l'y autorise.

                   L'attribut de capture ouvre l'appareil photo arrière
                   directement sur mobile ; sur un poste, il est ignoré et le
                   sélecteur de fichiers s'ouvre normalement. -->
              <div class="mt-3">
                @if (pt.item.photoPolicy === 'FORBIDDEN') {
                  <!-- Interdite : aucun bouton. Ce n'est pas une commodité
                       retirée, c'est une consigne — zone ATEX, dépôt ou client
                       qui proscrit la prise de vue. L'écrire évite que l'agent
                       cherche un bouton absent, ou photographie avec son
                       téléphone personnel à défaut. -->
                  <p class="flex items-start gap-2 text-[15px] leading-relaxed text-warn-ink">
                    <erp-icon name="ban" [size]="17" class="mt-0.5 shrink-0" />
                    <span>Prise de vue interdite sur ce point. Décrivez le constat dans le
                      commentaire.</span>
                  </p>
                } @else {
                  @if (pt.item.photoPolicy === 'REQUIRED') {
                    <p class="t-label">Photo exigée pour ce point</p>
                  }

                  <label class="t-btn-ghost cursor-pointer">
                    <erp-icon name="camera" [size]="18" />
                    {{ pt.item.photoPolicy === 'REQUIRED' ? 'Prendre la photo' : 'Ajouter une photo' }}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      class="sr-only"
                      (change)="prendrePhoto(pt.id, $event)"
                    />
                  </label>
                }

                @if (piecesLocales(pt, 'PHOTO'); as cliches) {
                  @if (cliches.length > 0) {
                    <div class="mt-2 flex flex-wrap gap-2">
                      @for (ph of cliches; track ph.clientUuid) {
                        <figure class="w-[104px]">
                          <img
                            [src]="ph.apercu"
                            alt="Cliché du contrôle"
                            class="h-[104px] w-[104px] rounded-[3px] border border-rule-strong object-cover"
                            [class.opacity-50]="ph.etat !== 'ACQUISE'"
                          />
                          <!-- L'état est écrit, jamais seulement suggéré par
                               une teinte : une photo « en attente » prise pour
                               « envoyée » fait clore une opération sans sa
                               preuve. -->
                          <figcaption class="mt-1 text-[13px] leading-tight">
                            @switch (ph.etat) {
                              @case ('ACQUISE') { <span class="text-ok">Reçue</span> }
                              @case ('ENVOI')   { <span class="text-ink-muted">Envoi…</span> }
                              @case ('REFUSEE') { <span class="text-crit">Refusée</span> }
                              @default          { <span class="text-warn-ink">En attente</span> }
                            }
                          </figcaption>
                          @if (ph.motif) {
                            <p class="mt-0.5 text-[13px] leading-snug text-crit">{{ ph.motif }}</p>
                            <button
                              type="button"
                              class="mt-1 text-[13px] font-semibold text-primary underline"
                              (click)="photos.retirer(ph.clientUuid)"
                            >
                              Retirer
                            </button>
                          }
                        </figure>
                      }
                    </div>
                  }
                }

                @if (photoManquante(pt)) {
                  <!-- Le sens du message change selon que la photo est absente
                       ou seulement en route : « prenez une photo » alors qu'elle
                       est en cours d'envoi ferait recommencer inutilement, et
                       chaque cliché repris consomme la liaison de l'agent. -->
                  @if (photoEnRoute(pt)) {
                    <p class="t-hint">
                      Photo en cours d’envoi. Le point pourra être enregistré dès qu’elle sera
                      reçue : attendez, ne la reprenez pas.
                    </p>
                  } @else {
                    <p class="t-hint">
                      Ce point exige une photo : il ne pourra pas être enregistré sans elle.
                      Le contrôleur HSE valide à distance, sur pièces : sans cliché, il n’a
                      rien à examiner.
                    </p>
                  }
                }
              </div>

              <!-- ================= Signature (§ 25/08/2026) =================
                   DISTINCTE de la photo : un point peut exiger les deux à la
                   fois, et le serveur refuse une pièce déposée sous la
                   mauvaise nature pour ce qu'elle prétend satisfaire. Le
                   bouton capture toujours une image (photo du document signé,
                   ou de la signature manuscrite) — seule la NATURE envoyée au
                   serveur change. -->
              @if (pt.item.requiresSignature) {
                <div class="mt-3">
                  <p class="t-label">Signature exigée pour ce point</p>

                  <label class="t-btn-ghost cursor-pointer">
                    <erp-icon name="camera" [size]="18" />
                    Photographier la signature
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      class="sr-only"
                      (change)="prendrePhoto(pt.id, $event, 'SIGNATURE')"
                    />
                  </label>

                  @if (piecesLocales(pt, 'SIGNATURE'); as signatures) {
                    @if (signatures.length > 0) {
                      <div class="mt-2 flex flex-wrap gap-2">
                        @for (ph of signatures; track ph.clientUuid) {
                          <figure class="w-[104px]">
                            <img
                              [src]="ph.apercu"
                              alt="Signature jointe au contrôle"
                              class="h-[104px] w-[104px] rounded-[3px] border border-rule-strong object-cover"
                              [class.opacity-50]="ph.etat !== 'ACQUISE'"
                            />
                            <figcaption class="mt-1 text-[13px] leading-tight">
                              @switch (ph.etat) {
                                @case ('ACQUISE') { <span class="text-ok">Reçue</span> }
                                @case ('ENVOI')   { <span class="text-ink-muted">Envoi…</span> }
                                @case ('REFUSEE') { <span class="text-crit">Refusée</span> }
                                @default          { <span class="text-warn-ink">En attente</span> }
                              }
                            </figcaption>
                            @if (ph.motif) {
                              <p class="mt-0.5 text-[13px] leading-snug text-crit">{{ ph.motif }}</p>
                              <button
                                type="button"
                                class="mt-1 text-[13px] font-semibold text-primary underline"
                                (click)="photos.retirer(ph.clientUuid)"
                              >
                                Retirer
                              </button>
                            }
                          </figure>
                        }
                      </div>
                    }
                  }

                  @if (signatureManquante(pt)) {
                    @if (signatureEnRoute(pt)) {
                      <p class="t-hint">
                        Signature en cours d’envoi. Le point pourra être enregistré dès qu’elle
                        sera reçue : attendez, ne la reprenez pas.
                      </p>
                    } @else {
                      <p class="t-hint">
                        Ce point exige une signature : il ne pourra pas être enregistré sans
                        elle.
                      </p>
                    }
                  }
                </div>
              }

              <button
                class="t-btn-primary mt-3"
                [disabled]="occupe() || !saisissable(pt)"
                (click)="renseigner(pt)"
              >
                Enregistrer ce point
              </button>
              @if (pt.item.requiresValue && !saisie(pt.id).recordedValue) {
                <p class="t-hint">La valeur est exigée pour ce point.</p>
              }
            }
          </div>
        }

        <!-- ================= Validation ================= -->
        <p class="t-section">Validation</p>
        @if (c.validatedAt) {
          <p class="t-hint">Cette checklist est déjà validée.</p>
        } @else if (!estControleur()) {
          <p class="rounded-[3px] border border-rule-strong bg-surface p-4 text-[15px] leading-relaxed text-ink-soft">
            Vous renseignez les points ; la validation revient au contrôleur HSE. C’est la
            séparation qui donne sa valeur au contrôle : personne ne valide son propre
            renseignement.
          </p>
        } @else {
          @if (restants(c) > 0) {
            <p class="rounded-[3px] border border-warn/50 bg-warn-wash p-4 text-[15px] text-warn-ink">
              {{ restants(c) }} point(s) restent à renseigner : la checklist ne peut pas encore
              être validée.
            </p>
          } @else if (bloquantsRenseignesParMoi(c) > 0) {
            <p class="rounded-[3px] border border-crit/30 bg-crit-wash p-4 text-[15px] leading-relaxed text-crit">
              Vous avez renseigné vous-même {{ bloquantsRenseignesParMoi(c) }} point(s) bloquant(s)
              de cette checklist. La validation sera refusée, un contrôle et sa
              validation ne peuvent pas venir de la même main.
            </p>
          } @else {
            <div class="t-actionbar">
              <button class="t-btn-primary" [disabled]="occupe()" (click)="valider(c)">
                {{ occupe() ? 'Envoi…' : 'Valider la checklist' }}
              </button>
            </div>
          }

          <!-- ================= Rejet =================
               ⚠️ CORRIGÉ (§ 25/08/2026) — proposé jusqu'ici en permanence,
               y compris sur une checklist entièrement conforme : rien n'y
               distinguait « je peux rejeter » de « j'ai une raison de le
               faire ». Il ne s'affiche plus que si un point est
               EFFECTIVEMENT non conforme (FAILED), auquel cas il est
               disponible dès maintenant, sans attendre que tout soit
               renseigné : le dire tout de suite évite d'attendre pour rien. -->
          @if (nonConforme(c)) {
            <div class="mt-4 rounded-[3px] border border-rule-strong bg-surface p-4">
              <p class="t-label">Rejeter cette checklist</p>
              <p class="mt-1 text-[14px] leading-relaxed text-ink-soft">
                Un point est marqué non conforme. Le rejet ne valide rien : les points
                restent modifiables pour reprendre ce qui ne va pas.
              </p>
              <textarea
                class="t-field mt-2"
                maxlength="1000"
                placeholder="Ce qui ne va pas, et ce qu’il faut reprendre (dix caractères au moins)"
                [ngModel]="motifRejet()"
                (ngModelChange)="motifRejet.set($event)"
              ></textarea>
              <div class="t-actionbar">
                <button
                  class="t-btn-ghost"
                  [disabled]="occupe() || motifRejet().trim().length < 10"
                  (click)="rejeter(c)"
                >
                  {{ occupe() ? 'Envoi…' : 'Rejeter la checklist' }}
                </button>
              </div>
            </div>
          }
        }
      }

      @if (checkId && !checklist() && !chargement()) {
        <p class="t-hint mt-6">
          Cette checklist n’a pas été trouvée sur l’opération. Revenez au dossier et rouvrez-la
          depuis la liste des contrôles.
        </p>
      }
    </div>
  `,
})
export class TerrainChecklistComponent implements OnInit {
  private readonly api = inject(FieldApiService);
  private readonly session = inject(FieldSessionService);
  private readonly router = inject(Router);
  protected readonly file = inject(FieldQueueService);
  /**
   * File des photos — DISTINCTE de celle des événements (§ 10.2).
   *
   * Un point renseigné doit partir tout de suite : c'est lui qui débloque
   * l'opération. Une photo de deux mégaoctets peut attendre le réseau. Les
   * mêler ferait dépendre le premier de la seconde.
   */
  protected readonly photos = inject(FieldPhotoService);

  @Input() id = '';
  /** Absent : l'ouverture se fait désormais depuis le dossier, pas ici (§ 25/08/2026). Présent : on la renseigne. */
  @Input() checkId = '';

  protected readonly resultats = RESULTATS_POINT;
  protected readonly dateHeureDe = jourHeure;
  protected readonly estControleur = this.session.estControleurHse;

  private readonly checks = signal<FieldCheck[]>([]);
  protected readonly chargement = signal(true);
  protected readonly occupe = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly motifRejet = signal('');

  protected readonly checklist = computed(
    () => this.checks().find((c) => c.id === this.checkId) ?? null,
  );

  /**
   * Saisies EN COURS, par point.
   *
   * Séparées de ce que rend l'API : tant que l'événement n'est pas acquis,
   * rien n'a changé en base, et afficher la saisie comme si elle était
   * enregistrée ferait croire à un contrôle qui n'existe pas.
   */
  private readonly brouillons = signal<
    Record<string, { outcome: string; recordedValue: string; comment: string }>
  >({});

  /**
   * URLs objet des pièces déjà en base, par identifiant de pièce.
   *
   * Même principe que `FieldPhotoService` pour la file locale : l'aperçu ne
   * vit qu'en mémoire, jamais dans un champ persisté.
   */
  private readonly urls = new Map<string, string>();
  /** Même pièce, en blob: — pour l'ouverture plein écran (voir `chargerImage`). */
  private readonly urlsOuverture = new Map<string, string>();

  ngOnInit(): void {
    this.recharger();
  }

  private recharger(): void {
    this.chargement.set(true);
    this.api.checks(this.id).subscribe({
      next: (c) => {
        this.checks.set(c);
        this.chargement.set(false);
        for (const check of c) {
          for (const pt of check.items) {
            for (const a of pt.attachments) {
              if (a.kind === 'PHOTO' && a.mimeType.startsWith('image/')) this.chargerImage(a.id);
            }
          }
        }
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messageServeur(e, 'Checklists indisponibles.'));
      },
    });
  }

  // --- Saisie -------------------------------------------------------------

  protected saisie(itemId: string) {
    return this.brouillons()[itemId] ?? { outcome: '', recordedValue: '', comment: '' };
  }

  /**
   * Prise de vue sur un point de contrôle.
   *
   * Le champ est VIDÉ après coup : sans cela, reprendre deux fois le même
   * cliché ne déclencherait pas d'événement `change` la seconde fois — le
   * navigateur considère que la valeur n'a pas bougé — et l'agent croirait
   * avoir photographié alors que rien n'est parti.
   */
  protected async prendrePhoto(
    checkItemId: string,
    evenement: Event,
    nature: NaturePiece = 'PHOTO',
  ): Promise<void> {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0];
    champ.value = '';
    if (!fichier) return;
    await this.photos.ajouter(fichier, { checkItemId }, nature);
  }

  protected choisir(itemId: string, code: string): void {
    this.majBrouillon(itemId, { outcome: code });
  }

  /**
   * Classe du bouton de résultat.
   *
   * Le choix retenu est marqué par un cerclage épais et un fond lavé, PAS par
   * la seule teinte : sur un contrôle de sécurité, un rouge indistinct d'un
   * vert est un risque opérationnel (§ 17.2).
   */
  protected classeChoix(itemId: string, r: ResultatPoint): string {
    return this.saisie(itemId).outcome === r.code ? `t-choice ${r.marque}` : 't-choice';
  }

  protected majValeur(itemId: string, valeur: string): void {
    this.majBrouillon(itemId, { recordedValue: valeur });
  }

  protected majCommentaire(itemId: string, valeur: string): void {
    this.majBrouillon(itemId, { comment: valeur });
  }

  private majBrouillon(
    itemId: string,
    part: Partial<{ outcome: string; recordedValue: string; comment: string }>,
  ): void {
    this.brouillons.update((etat) => ({
      ...etat,
      [itemId]: { ...this.saisie(itemId), ...part },
    }));
  }

  /**
   * Le point peut-il partir ?
   *
   * ⚠️ ON NE LAISSE JAMAIS PRODUIRE UN ÉVÉNEMENT VOUÉ AU REFUS.
   *
   *    Un refus BRÛLE l'identifiant : le serveur tient un journal en ajout
   *    seul, l'événement refusé ne repartira jamais, et l'agent devra refaire
   *    la saisie. Laisser cliquer « enregistrer » sur un point dont on sait
   *    déjà qu'il sera refusé, c'est lui faire perdre son travail.
   */
  /** Pièces LOCALES de cette nature pour ce point — filtrées, jamais mêlées. */
  protected piecesLocales(pt: FieldCheckItem, nature: NaturePiece) {
    return this.photos.pourPoint(pt.id).filter((p) => p.nature === nature);
  }

  protected saisissable(pt: FieldCheckItem): boolean {
    const s = this.saisie(pt.id);
    if (s.outcome === '') return false;
    if (pt.item.requiresValue && s.recordedValue.trim() === '') return false;

    // Photo et signature EXIGÉES INDÉPENDAMMENT : un point peut demander les
    // deux à la fois (§ 25/08/2026, ex. « les vannes sont-elles scellées » —
    // photo du scellé, signature du chauffeur). La base refuse le point tant
    // que la pièce de la bonne NATURE ne lui est pas rattachée ; une pièce
    // « en attente » ou « en envoi » ne compte pas — elle n'est pas encore en
    // base, et le déclencheur ne la verra pas.
    if (pt.item.photoPolicy === 'REQUIRED') {
      if (!this.piecesLocales(pt, 'PHOTO').some((p) => p.etat === 'ACQUISE')) return false;
    }
    if (pt.item.requiresSignature) {
      if (!this.piecesLocales(pt, 'SIGNATURE').some((p) => p.etat === 'ACQUISE')) return false;
    }
    return true;
  }

  /** Vrai si une photo exigée manque encore, pour l'expliquer à l'agent. */
  protected photoManquante(pt: FieldCheckItem): boolean {
    return (
      pt.item.photoPolicy === 'REQUIRED' &&
      !this.piecesLocales(pt, 'PHOTO').some((p) => p.etat === 'ACQUISE')
    );
  }

  /** Vrai si la photo est prise mais pas encore parvenue au serveur. */
  protected photoEnRoute(pt: FieldCheckItem): boolean {
    return this.piecesLocales(pt, 'PHOTO').some((p) => p.etat === 'EN_ATTENTE' || p.etat === 'ENVOI');
  }

  /** Vrai si une signature exigée manque encore, pour l'expliquer à l'agent. */
  protected signatureManquante(pt: FieldCheckItem): boolean {
    return (
      !!pt.item.requiresSignature &&
      !this.piecesLocales(pt, 'SIGNATURE').some((p) => p.etat === 'ACQUISE')
    );
  }

  /** Vrai si la signature est prise mais pas encore parvenue au serveur. */
  protected signatureEnRoute(pt: FieldCheckItem): boolean {
    return this.piecesLocales(pt, 'SIGNATURE').some(
      (p) => p.etat === 'EN_ATTENTE' || p.etat === 'ENVOI',
    );
  }

  // --- Lecture ------------------------------------------------------------

  protected bloquant(pt: FieldCheckItem): boolean {
    return pt.level === NIVEAU_BLOQUANT;
  }

  protected niveauLabel(level: string): string {
    return NIVEAU_CONTROLE[level] ?? level;
  }

  protected outcomeLabel(outcome: string): string {
    return RESULTAT_ENREGISTRE[outcome] ?? outcome;
  }

  /**
   * Photos ET signatures déjà en base pour ce point — pas les documents.
   *
   * Les deux natures se mêlent ici sans distinction : cette liste sert la
   * RELECTURE (le contrôleur valide à distance, sur pièces, § 7.2), où voir
   * les deux preuves ensemble suffit. La distinction ne compte qu'au DÉPÔT,
   * où le serveur refuse une pièce de la mauvaise nature pour ce qu'elle
   * prétend satisfaire.
   */
  protected photosEnBase(pt: FieldCheckItem) {
    return pt.attachments.filter(
      (a) => (a.kind === 'PHOTO' || a.kind === 'SIGNATURE') && a.mimeType.startsWith('image/'),
    );
  }

  protected urlPiece(attachmentId: string): string | null {
    return this.urls.get(attachmentId) ?? null;
  }

  protected urlOuverture(attachmentId: string): string | null {
    return this.urlsOuverture.get(attachmentId) ?? null;
  }

  /**
   * ⚠️ EN DATA:, PAS EN BLOB: — LE CSP NE S'ASSOUPLIT PAS POUR LE CONTOURNER.
   *
   *    `img-src` n'admet que `'self'` et `data:` (docker/nginx/security-
   *    headers.conf) : une image chargée en `URL.createObjectURL(blob)`
   *    s'affiche vide, silencieusement refusée par le navigateur, sans que
   *    rien ne le signale à l'écran — le contrôleur voit juste l'alternatif
   *    de l'image, jamais la photo. `data:` est déjà une source admise ; se
   *    convertir vers elle évite d'élargir le CSP pour ce seul besoin.
   */
  private chargerImage(id: string): void {
    if (this.urls.has(id)) return;
    this.api.attachmentBlob(id).subscribe((blob) => {
      const lecteur = new FileReader();
      lecteur.onload = () => this.urls.set(id, lecteur.result as string);
      lecteur.readAsDataURL(blob);
      // Second lien, EN BLOB: CETTE FOIS — pour l'ouverture plein écran, une
      // navigation de premier niveau que Chrome refuse en data: mais admet
      // en blob:. Les deux formes cohabitent : l'une pour l'affichage
      // inline, l'autre pour la navigation, chacune dans le registre que
      // le navigateur accepte réellement.
      this.urlsOuverture.set(id, URL.createObjectURL(blob));
    });
  }

  /**
   * Points restant à renseigner.
   *
   * Comptés sur l'état PENDING rendu par l'API — c'est-à-dire sur l'état de
   * départ posé à l'ouverture de la checklist. On ne le déduit pas d'une liste
   * de résultats écrite ici : un résultat ajouté demain côté serveur ferait
   * mentir le compteur.
   */
  protected restants(c: FieldCheck): number {
    return c.items.filter((i) => i.outcome === ETAT_INITIAL).length;
  }

  protected renseignes(c: FieldCheck): number {
    return c.items.length - this.restants(c);
  }

  /**
   * Points bloquants que l'utilisateur connecté a renseignés lui-même.
   *
   * Le rapprochement se fait sur le nom complet : la vue des checklists rend
   * `recordedByFieldUser.fullName` et non l'identifiant. C'est un CONFORT
   * d'affichage, pas un contrôle — la règle est tenue en base, qui dispose,
   * elle, des identifiants. En cas d'homonymie, la base tranchera ; l'écran
   * aura seulement prévenu à tort ou pas prévenu.
   */
  protected bloquantsRenseignesParMoi(c: FieldCheck): number {
    const moi = this.session.profil()?.fullName;
    if (!moi) return 0;
    return c.items.filter(
      (i) => i.level === NIVEAU_BLOQUANT && i.recordedByFieldUser?.fullName === moi,
    ).length;
  }

  /** Au moins un point marqué non conforme — seul motif qui justifie d'offrir le rejet. */
  protected nonConforme(c: FieldCheck): boolean {
    return c.items.some((i) => i.outcome === 'FAILED');
  }

  // --- Production d'événements --------------------------------------------

  protected async renseigner(pt: FieldCheckItem): Promise<void> {
    const s = this.saisie(pt.id);
    await this.envoyer({
      operationId: this.id,
      reference: this.id,
      type: 'CHECK_ITEM_RECORDED',
      intitule: `${pt.item.label} : ${s.outcome}`,
      payload: {
        // `checkItemId` est une clé d'ADRESSAGE : sur l'API classique c'est un
        // segment d'URL, un événement n'en a pas, il la transporte donc dans sa
        // charge. Le serveur l'écarte avant de valider le reste contre
        // `RecordItemDto`.
        checkItemId: pt.id,
        outcome: s.outcome,
        ...(s.recordedValue.trim() ? { recordedValue: s.recordedValue.trim() } : {}),
        ...(s.comment.trim() ? { comment: s.comment.trim() } : {}),
        // Ni horodatage ni position ici : ils voyagent dans l'ENVELOPPE de
        // l'événement, et le serveur les y prend. Un relevé fait à 14 h 32 hors
        // connexion s'est fait à 14 h 32, pas à l'heure de la remontée.
      },
    });
  }

  protected async valider(c: FieldCheck): Promise<void> {
    await this.envoyer(
      {
        operationId: this.id,
        reference: this.id,
        type: 'CHECK_VALIDATED',
        intitule: `Validation de la checklist ${c.phase}`,
        // `checkId` est une clé d'adressage, comme `checkItemId`. `remotely`
        // n'est pas transmis : le serveur retient « à distance » par défaut, et
        // ce champ relève de l'organisation du contrôle, pas de la tablette.
        payload: { checkId: c.id },
      },
      { quitterApresAcquis: true },
    );
  }

  protected async rejeter(c: FieldCheck): Promise<void> {
    const motif = this.motifRejet().trim();
    await this.envoyer(
      {
        operationId: this.id,
        reference: this.id,
        type: 'CHECK_REJECTED',
        intitule: `Rejet de la checklist ${c.phase}`,
        payload: { checkId: c.id, reason: motif },
      },
      { quitterApresAcquis: true },
    );
    // Le motif n'est effacé qu'en cas d'échec net (refus) : un événement
    // simplement mis en file, ou suspendu derrière un refus antérieur,
    // repartira avec la même charge — perdre la saisie ici la rendrait
    // introuvable au renvoi.
    if (this.erreur() === null) this.motifRejet.set('');
  }

  /**
   * Met en file et n'inscrit à l'écran que ce qui a été jugé.
   *
   * Le rechargement n'a lieu qu'en cas d'ACQUIS : recharger sur un refus
   * afficherait l'ancien état comme s'il venait d'être confirmé, et effacerait
   * du même geste la saisie que l'agent doit reprendre.
   *
   * ⚠️ `quitterApresAcquis` — CORRIGÉ (§ 25/08/2026).
   *
   *    Le périmètre du contrôleur HSE inclut une opération SEULEMENT tant
   *    qu'une de ses checklists l'attend (`FieldScopeService.where`). Valider
   *    ou rejeter LA SEULE checklist qui l'y rattachait lui retire donc à
   *    l'instant même l'accès à cette opération — le rechargement qui
   *    suivait AUTOMATIQUEMENT retombait sur un 404 maquillé en refus
   *    (« Cet élément ne figure pas dans votre affectation »), affiché à
   *    l'écran comme si l'action elle-même avait échoué, alors qu'elle avait
   *    réussi (vérifié en base). Pour ces deux actions, on quitte vers la
   *    liste plutôt que de recharger un dossier qu'on vient peut-être de
   *    perdre.
   */
  private async envoyer(
    depot: DepotEvenement,
    options?: { quitterApresAcquis?: boolean },
  ): Promise<void> {
    this.occupe.set(true);
    this.erreur.set(null);
    this.info.set(null);

    const compte = await deposer(this.file, depot);
    this.occupe.set(false);
    this.info.set(compte.info);
    this.erreur.set(compte.erreur);

    if (compte.acquis) {
      this.brouillons.set({});
      if (options?.quitterApresAcquis) {
        // Un bref délai, pour que le message de succès déjà affiché
        // (`compte.info`) reste lisible avant que l'écran ne change sous les
        // yeux du contrôleur.
        setTimeout(() => this.router.navigate(['/terrain']), 1500);
      } else {
        this.recharger();
      }
    }
  }
}

/**
 * État de départ d'un point de contrôle, posé par le serveur à l'ouverture de
 * la checklist. Ce n'est pas un résultat que l'agent peut choisir — il n'est
 * donc pas dans `RESULTATS_POINT` — mais l'interface doit le reconnaître pour
 * compter ce qui reste à faire.
 */
const ETAT_INITIAL = 'PENDING';
