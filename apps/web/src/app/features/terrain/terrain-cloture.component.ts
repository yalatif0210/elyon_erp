import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FieldApiService, FieldDocumentView, FieldOperationDetail } from '../../core/field-api.service';
import { messageDeRefus } from '../../core/field-queue.service';
import { FieldSessionService } from '../../core/field-session.service';
import { IconComponent } from '../../shared/icon.component';
import { TerrainRetourComponent } from './terrain-cadre.component';

const ROLE_LABEL: Record<string, string> = {
  FIELD_AGENT: 'Agent terrain',
  HSE_CONTROLLER: 'Contrôleur HSE',
};

/**
 * CLÔTURE TERRAIN — rapport d'exécution et bon de livraison (§ 10, § 12.2).
 *
 * ⚠️ CETTE PIÈCE MANQUAIT — MÊME SI TOUTE L'INFRASTRUCTURE DE SIGNATURE
 *    EXISTAIT DÉJÀ CÔTÉ SERVEUR (`FieldDocumentsController`).
 *
 *    Rien ne produisait jamais `OPERATION_REPORT` ni `DELIVERY_NOTE`, et
 *    aucun écran ne proposait de les signer. Cet écran ferme la boucle :
 *    déclencher la génération, puis signer, chacune des deux pièces exigeant
 *    des signataires différents — le serveur seul en juge (`DocumentsService
 *    .seal`), cet écran ne fait qu'exposer les boutons dans le bon ordre.
 *
 *    L'agent signe TOUJOURS lui-même en premier — c'est un constat qu'il
 *    fait, jamais une saisie pour le compte d'autrui. Le formulaire du
 *    représentant du client n'apparaît qu'une fois cette première signature
 *    acquise : lui seul renseigne son nom, sur l'écran que l'agent lui tend.
 */
@Component({
  selector: 'terrain-cloture',
  standalone: true,
  imports: [FormsModule, TerrainRetourComponent, IconComponent],
  template: `
    <div class="t-screen">
      <terrain-retour [operationId]="id" />

      <h1 class="t-title mt-2">Clôturer l’opération</h1>
      <p class="t-sub">
        Le rapport d’exécution est attesté par vous seul. Le bon de livraison engage aussi le
        client : les deux signatures lui sont nécessaires.
      </p>

      @if (erreur()) {
        <div
          class="mt-3 flex items-start gap-2 rounded-[3px] border border-crit/30 bg-crit-wash
                 px-3.5 py-3 text-[15px] leading-relaxed text-crit"
          role="alert"
        >
          <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
          <span>{{ erreur() }}</span>
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

      @if (chargement()) {
        <p class="mt-8 text-center text-[15px] text-ink-muted">Chargement…</p>
      }

      @if (operation(); as op) {
        @if (!rapport() && !bonLivraison()) {
          <div class="mt-5 rounded-[3px] border border-rule-strong bg-surface p-4">
            <p class="text-[15px] leading-relaxed text-ink-soft">
              Aucune pièce de clôture n’existe encore pour cette opération. La génération compile
              les contrôles HSE, les incidents et les photos prises en un rapport, et prépare le
              bon de livraison à partir du relevé faisant foi.
            </p>
            <button
              class="t-btn-primary mt-4"
              [disabled]="occupe() || generationEnCours()"
              (click)="generer()"
            >
              {{ generationEnCours() ? 'Génération en cours…' : 'Générer les documents de clôture' }}
            </button>
          </div>
        }

        @if (rapport(); as r) {
          <p class="t-section">Rapport d’exécution</p>
          <div class="t-card">
            <p class="font-mono text-[14px] font-bold text-gray-900">{{ r.reference }}</p>
            @if (r.isSealed) {
              <p class="mt-2 flex items-center gap-2 text-[15px] font-semibold text-ok">
                <erp-icon name="check-circle" [size]="18" />
                Signé et scellé
              </p>
            } @else {
              <p class="mt-2 text-[15px] text-ink-soft">En attente de votre signature.</p>
              <button
                class="t-btn-primary mt-3"
                [disabled]="occupe()"
                (click)="signerAgent(r)"
              >
                {{ occupe() ? 'Envoi…' : 'Signer le rapport' }}
              </button>
            }
          </div>
        }

        @if (bonLivraison(); as b) {
          <p class="t-section">Bon de livraison</p>
          <div class="t-card">
            <p class="font-mono text-[14px] font-bold text-gray-900">{{ b.reference }}</p>

            @if (b.isSealed) {
              <p class="mt-2 flex items-center gap-2 text-[15px] font-semibold text-ok">
                <erp-icon name="check-circle" [size]="18" />
                Signé par les deux parties et scellé
              </p>
            } @else {
              @if (!signeParAgent(b)) {
                <p class="mt-2 text-[15px] text-ink-soft">En attente de votre signature.</p>
                <button
                  class="t-btn-primary mt-3"
                  [disabled]="occupe()"
                  (click)="signerAgent(b)"
                >
                  {{ occupe() ? 'Envoi…' : 'Signer le bon de livraison' }}
                </button>
              } @else {
                <p class="mt-2 flex items-center gap-2 text-[15px] font-semibold text-ok">
                  <erp-icon name="check-circle" [size]="18" />
                  Vous avez signé, au tour du client
                </p>

                <div class="mt-4">
                  <label class="t-label" for="client-nom">Nom du représentant du client</label>
                  <input id="client-nom" class="t-field" maxlength="160" [(ngModel)]="clientNom" />
                </div>
                <div class="mt-3">
                  <label class="t-label" for="client-qualite">Qualité (fonction)</label>
                  <input
                    id="client-qualite"
                    class="t-field"
                    maxlength="160"
                    placeholder="Chef de site, magasinier…"
                    [(ngModel)]="clientQualite"
                  />
                </div>
                <p class="t-hint">
                  Tendez la tablette au représentant du client : c’est à lui de confirmer son nom
                  et sa qualité avant l’envoi.
                </p>
                <button
                  class="t-btn-primary mt-3"
                  [disabled]="occupe() || !clientComplet()"
                  (click)="signerClient(b)"
                >
                  {{ occupe() ? 'Envoi…' : 'Signer pour le client' }}
                </button>
              }
            }
          </div>
        }
      }
    </div>
  `,
})
export class TerrainClotureComponent implements OnInit {
  private readonly api = inject(FieldApiService);
  protected readonly session = inject(FieldSessionService);

  @Input() id = '';

  protected readonly operation = signal<FieldOperationDetail | null>(null);
  protected readonly chargement = signal(true);
  protected readonly occupe = signal(false);
  protected readonly generationEnCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected clientNom = '';
  protected clientQualite = '';

  ngOnInit(): void {
    this.charger();
  }

  protected rapport(): FieldDocumentView | null {
    return this.operation()?.documents.find((d) => d.kind === 'OPERATION_REPORT') ?? null;
  }

  protected bonLivraison(): FieldDocumentView | null {
    return this.operation()?.documents.find((d) => d.kind === 'DELIVERY_NOTE') ?? null;
  }

  protected signeParAgent(doc: FieldDocumentView): boolean {
    return doc.signatureKinds.includes('FIELD_USER');
  }

  protected clientComplet(): boolean {
    return this.clientNom.trim() !== '' && this.clientQualite.trim() !== '';
  }

  protected generer(): void {
    this.occupe.set(true);
    this.generationEnCours.set(true);
    this.erreur.set(null);
    this.info.set(null);
    this.api.genererCloture(this.id).subscribe({
      next: () => {
        this.info.set('Génération en cours : cette page se met à jour automatiquement.');
        this.attendreGeneration();
      },
      error: (e: unknown) => {
        this.occupe.set(false);
        this.generationEnCours.set(false);
        this.erreur.set(messageDeRefus(e, 'Génération impossible.'));
      },
    });
  }

  protected signerAgent(doc: FieldDocumentView): void {
    const profil = this.session.profil();
    if (!profil) return;
    this.signer(doc, {
      kind: 'FIELD_USER',
      signatoryName: profil.fullName,
      signatoryCapacity: ROLE_LABEL[profil.role] ?? profil.role,
    });
  }

  protected signerClient(doc: FieldDocumentView): void {
    this.signer(doc, {
      kind: 'CLIENT_REPRESENTATIVE',
      signatoryName: this.clientNom.trim(),
      signatoryCapacity: this.clientQualite.trim(),
    });
  }

  private signer(doc: FieldDocumentView, dto: { kind: string; signatoryName: string; signatoryCapacity: string }): void {
    this.occupe.set(true);
    this.erreur.set(null);
    this.info.set(null);
    this.api.signerDocument(doc.id, dto).subscribe({
      next: () => {
        this.clientNom = '';
        this.clientQualite = '';
        this.info.set(`${doc.reference} signé.`);
        this.charger();
      },
      error: (e: unknown) => {
        this.occupe.set(false);
        this.erreur.set(messageDeRefus(e, 'Signature impossible.'));
      },
    });
  }

  private charger(): void {
    this.api.operation(this.id).subscribe({
      next: (d) => {
        this.operation.set(d);
        this.chargement.set(false);
        this.occupe.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.occupe.set(false);
        this.erreur.set(messageDeRefus(e, 'Opération inaccessible.'));
      },
    });
  }

  /** Reconsulte le dossier jusqu’à ce que les deux pièces apparaissent — la génération est asynchrone. */
  private attendreGeneration(tentative = 0): void {
    if (tentative >= 12) {
      this.occupe.set(false);
      this.generationEnCours.set(false);
      this.erreur.set(
        'La génération prend plus de temps que prévu. Quittez cet écran puis revenez-y dans un instant.',
      );
      return;
    }
    setTimeout(() => {
      this.api.operation(this.id).subscribe({
        next: (d) => {
          this.operation.set(d);
          const pret =
            d.documents.some((doc) => doc.kind === 'OPERATION_REPORT') &&
            d.documents.some((doc) => doc.kind === 'DELIVERY_NOTE');
          if (pret) {
            this.occupe.set(false);
            this.generationEnCours.set(false);
            this.info.set('Documents générés : vous pouvez signer.');
          } else {
            this.attendreGeneration(tentative + 1);
          }
        },
        error: () => this.attendreGeneration(tentative + 1),
      });
    }, 3000);
  }
}
