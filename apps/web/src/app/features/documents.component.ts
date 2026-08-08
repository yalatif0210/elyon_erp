import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DealRow } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';

interface DocumentRow {
  id: string;
  kind: string;
  reference: string;
  isSealed: boolean;
  sealedAt: string | null;
  sha256: string;
  authenticityToken: string;
  generatedAt: string;
  deal: { reference: string } | null;
  operation: { reference: string } | null;
  supersedes: { reference: string } | null;
  generatedBy: { fullName: string } | null;
  _count: { signatures: number };
}

const KINDS: Record<string, string> = {
  PROFORMA: 'Proforma',
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  DELIVERY_NOTE: 'Bon de livraison',
  OPERATION_REPORT: 'Rapport d’exécution',
  TRANSPORT_ORDER: 'Ordre de transport',
  MEASUREMENT_REPORT: 'Rapport de mesure',
};

/**
 * Registre documentaire et signatures (§ 12).
 *
 * Le binaire n'est jamais en base : seules la clé de stockage et l'empreinte
 * SHA-256 y figurent. C'est elle qui permet, des années plus tard, de
 * confronter un papier présenté par un client, un assureur ou un auditeur à
 * ce que le système a réellement émis.
 *
 * UNE PIÈCE SCELLÉE NE SE MODIFIE PLUS. La correction produit un nouveau
 * document « annule et remplace », avec son motif.
 */
@Component({
  selector: 'erp-documents',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Documents et signatures</h1>
      <p class="page-sub">
        Pièces produites, signatures des parties prenantes, scellement et remplacement
      </p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============ Enregistrer une pièce ============ -->
    <section class="card mb-5">
      <div class="card-header"><h2 class="card-title">Enregistrer une pièce</h2></div>
      <div class="card-body">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label class="label" for="nature">Nature</label>
            <select id="nature" class="field" [(ngModel)]="newKind">
              @for (k of kinds; track k.code) {
                <option [ngValue]="k.code">{{ k.label }}</option>
              }
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="label" for="rattache">Rattachée à l’affaire</label>
            <select id="rattache" class="field" [(ngModel)]="newDealId">
              <option [ngValue]="''">— choisir —</option>
              @for (d of deals(); track d.id) {
                <option [ngValue]="d.id">{{ d.reference }} · {{ d.client.legalName }}</option>
              }
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="label" for="cle-new">Clé de stockage</label>
            <input id="cle-new" class="field font-mono" [(ngModel)]="newStorageKey" />
          </div>
          <div>
            <label class="label" for="sha-new">Empreinte SHA-256</label>
            <input id="sha-new" class="field font-mono" maxlength="64" [(ngModel)]="newSha256" />
          </div>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Une pièce non rattachée à une affaire, une opération ou une facture est introuvable le
          jour où on la cherche — la base la refuse.
        </p>
        <button class="btn-primary mt-3" (click)="register()" [disabled]="state.busy()">
          Enregistrer la pièce
        </button>
      </div>
    </section>

    <div class="card mb-5 overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Nature</th>
            <th>Rattachée à</th>
            <th class="num">Signatures</th>
            <th>État</th>
            <th>Remplace</th>
            <th style="width: 220px">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr>
              <td><span class="ref">{{ d.reference }}</span></td>
              <td class="text-ink-soft">{{ kind(d.kind) }}</td>
              <td class="font-mono text-[12px] text-ink-muted">
                {{ d.operation?.reference ?? d.deal?.reference ?? '—' }}
              </td>
              <td class="num font-mono" [class]="d._count.signatures > 0 ? 'text-ink' : 'text-ink-faint'">
                {{ d._count.signatures }}
              </td>
              <td>
                @if (d.isSealed) {
                  <span class="badge-ok">
                    <erp-icon name="lock" [size]="11" />
                    Scellée
                  </span>
                } @else {
                  <span class="badge-wait">
                    <erp-icon name="clock" [size]="11" />
                    Modifiable
                  </span>
                }
              </td>
              <td class="font-mono text-[12px] text-ink-muted">
                {{ d.supersedes?.reference ?? '—' }}
              </td>
              <td>
                @if (!d.isSealed) {
                  <button class="link mr-2 text-[12px]" (click)="openSign(d)">Signer</button>
                  <button class="link text-[12px]" (click)="seal(d)">Sceller</button>
                } @else {
                  <button class="link text-[12px]" (click)="openSupersede(d)">
                    Annule et remplace
                  </button>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="empty">
                Aucune pièce enregistrée. Une pièce non rattachée à une affaire, une opération
                ou une facture serait introuvable le jour où on la cherche.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <!-- ============ Signature ============ -->
    @if (signing(); as doc) {
      <section class="card mb-5">
        <div class="card-header">
          <h2 class="card-title">Signer {{ doc.reference }}</h2>
        </div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label class="label" for="qui">Qualité du signataire</label>
              <select id="qui" class="field" [(ngModel)]="signatoryKind">
                <option value="CLIENT_REPRESENTATIVE">Représentant du client</option>
                <option value="DRIVER">Chauffeur</option>
                <option value="INTERNAL_USER">Agent Elyon</option>
                <option value="INSPECTOR">Inspecteur</option>
              </select>
            </div>
            <div>
              <label class="label" for="nom">Nom</label>
              <input id="nom" class="field" [(ngModel)]="signatoryName" />
            </div>
            <div>
              <label class="label" for="qualite">Fonction</label>
              <input id="qualite" class="field" [(ngModel)]="signatoryCapacity" />
            </div>
            <div>
              <label class="label" for="piece">Pièce d’identité</label>
              <input id="piece" class="field" [(ngModel)]="idDocumentRef" />
            </div>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
            La qualité du signataire est indispensable à l’opposabilité : savoir qui a signé ne
            suffit pas, il faut savoir à quel titre.
          </p>
          <div class="mt-3 flex gap-2">
            <button class="btn-primary" (click)="sign(doc)" [disabled]="state.busy()">
              Apposer la signature
            </button>
            <button class="btn-ghost" (click)="signing.set(null)">Annuler</button>
          </div>
        </div>
      </section>
    }

    <!-- ============ Annule et remplace ============ -->
    @if (superseding(); as doc) {
      <section class="card mb-5 border-warn/40">
        <div class="card-header">
          <h2 class="card-title">Remplacer {{ doc.reference }}</h2>
        </div>
        <div class="card-body">
          <p class="mb-3 text-[13px] text-ink-soft">
            La pièce d’origine reste en place : on ne réécrit pas l’histoire, on la complète.
          </p>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label class="label" for="cle">Clé de stockage du nouveau fichier</label>
              <input id="cle" class="field font-mono" [(ngModel)]="storageKey" />
            </div>
            <div>
              <label class="label" for="empreinte">Empreinte SHA-256</label>
              <input id="empreinte" class="field font-mono" maxlength="64" [(ngModel)]="sha256" />
            </div>
          </div>
          <div class="mt-3">
            <label class="label" for="motif-doc">Motif du remplacement</label>
            <input
              id="motif-doc"
              class="field"
              [(ngModel)]="supersessionReason"
              placeholder="Pourquoi cette pièce en remplace-t-elle une autre ?"
            />
          </div>
          <div class="mt-3 flex gap-2">
            <button class="btn-primary" (click)="supersede(doc)" [disabled]="state.busy()">
              Émettre le remplacement
            </button>
            <button class="btn-ghost" (click)="superseding.set(null)">Annuler</button>
          </div>
        </div>
      </section>
    }

    <p class="text-[11px] leading-relaxed text-ink-faint">
      Le binaire n’est jamais conservé en base : seules la clé de stockage et l’empreinte
      SHA-256 le sont. C’est elle qui permet de confronter un papier présenté des années plus
      tard à ce que le système a réellement émis.
    </p>
  `,
})
export class DocumentsComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly rows = signal<DocumentRow[]>([]);
  protected readonly signing = signal<DocumentRow | null>(null);
  protected readonly superseding = signal<DocumentRow | null>(null);
  protected readonly state = new ActionState();

  protected signatoryKind = 'CLIENT_REPRESENTATIVE';
  protected signatoryName = '';
  protected signatoryCapacity = '';
  protected idDocumentRef = '';

  protected readonly deals = signal<DealRow[]>([]);
  protected readonly kinds = Object.entries(KINDS).map(([code, label]) => ({ code, label }));

  protected newKind = 'DELIVERY_NOTE';
  protected newDealId = '';
  protected newStorageKey = '';
  protected newSha256 = '';

  protected storageKey = '';
  protected sha256 = '';
  protected supersessionReason = '';

  ngOnInit(): void {
    this.load();
    this.api.deals(1, {}).subscribe((p) => this.deals.set(p.items));
  }

  protected register(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .registerDocument({
        kind: this.newKind,
        dealId: this.newDealId || undefined,
        storageKey: this.newStorageKey,
        sizeBytes: 1024,
        sha256: this.newSha256,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Pièce enregistrée.');
          this.newStorageKey = '';
          this.newSha256 = '';
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected kind(k: string): string {
    return KINDS[k] ?? k;
  }

  protected openSign(d: DocumentRow): void {
    this.superseding.set(null);
    this.signing.set(d);
  }

  protected openSupersede(d: DocumentRow): void {
    this.signing.set(null);
    this.storageKey = `documents/${new Date().getFullYear()}/remplacement-${d.reference}.pdf`;
    this.sha256 = '';
    this.supersessionReason = '';
    this.superseding.set(d);
  }

  protected sign(d: DocumentRow): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .signDocument(d.id, {
        kind: this.signatoryKind,
        signatoryName: this.signatoryName,
        signatoryCapacity: this.signatoryCapacity,
        idDocumentRef: this.idDocumentRef || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Signature apposée.');
          this.signing.set(null);
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected seal(d: DocumentRow): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.sealDocument(d.id).subscribe({
      next: () => {
        this.state.succeed(`${d.reference} scellée — elle ne se modifie plus.`);
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected supersede(d: DocumentRow): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .supersedeDocument(d.id, {
        kind: d.kind,
        storageKey: this.storageKey,
        sizeBytes: 1024,
        sha256: this.sha256,
        reason: this.supersessionReason,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Pièce de remplacement émise.');
          this.superseding.set(null);
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  private load(): void {
    this.api.documents().subscribe((p) => this.rows.set(p.items as DocumentRow[]));
  }
}
