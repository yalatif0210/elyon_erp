import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FieldApiService, FieldOperationDetail } from '../../core/field-api.service';
import { messageDeRefus } from '../../core/field-queue.service';
import { IconComponent } from '../../shared/icon.component';
import { jour, jourHeure } from './terrain-libelles';

/**
 * DOSSIER D'OPÉRATION.
 *
 * Rien d'autre que ce que rend `GET /api/field/operations/:id`. La vue est un
 * objet DÉDIÉ côté serveur, pas un filtrage : aucun prix, aucune marge, aucun
 * encours n'y figure, et rien ne doit être complété d'ailleurs.
 *
 * L'écran est une page qui se déroule, pas un jeu d'onglets. Sur site, l'agent
 * cherche une information précise — la consigne d'accès, la plaque du camion —
 * et un onglet fermé est une information qu'il faut deviner avant de la
 * trouver. Les actions, elles, sont des ÉCRANS séparés : une action par écran.
 */
@Component({
  selector: 'terrain-operation',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="t-screen">
      <a routerLink="/terrain" class="inline-flex min-h-[52px] items-center gap-1.5 text-[15px] font-semibold text-primary">
        <erp-icon name="arrow-right" [size]="17" class="rotate-180" />
        Mes opérations
      </a>

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

      @if (chargement()) {
        <p class="mt-8 text-center text-[15px] text-ink-muted">Chargement…</p>
      }

      @if (operation(); as op) {
        <h1 class="t-title mt-2 font-mono">{{ op.reference }}</h1>
        <p class="t-sub">{{ op.clientLegalName }}</p>

        <div class="mt-3 flex flex-wrap gap-2">
          <span class="rounded-[3px] bg-gray-100 px-2.5 py-1.5"><span class="t-code">{{ op.status }}</span></span>
          <span class="rounded-[3px] bg-gray-100 px-2.5 py-1.5"><span class="t-code">{{ op.transportMode }}</span></span>
          <span class="rounded-[3px] bg-gray-100 px-2.5 py-1.5"><span class="t-code">RISQUE {{ op.hse.riskLevel }}</span></span>
        </div>

        <!-- ======================= Verrou HSE ======================= -->
        <!--
          Le verrou est en tête parce qu'il commande tout le reste : tant qu'un
          point bloquant n'est pas levé, le chargement sera refusé, quel
          que soit le chemin emprunté. L'agent doit le savoir AVANT de se
          demander pourquoi son changement d'état est refusé.
        -->
        <p class="t-section">Contrôles HSE</p>
        <div class="rounded-[3px] border p-4" [class]="op.hse.validatedAt ? 'border-ok/40 bg-ok-wash' : 'border-warn/50 bg-warn-wash'">
          <p class="flex items-center gap-2 text-[16px] font-semibold" [class]="op.hse.validatedAt ? 'text-ok' : 'text-warn-ink'">
            <erp-icon [name]="op.hse.validatedAt ? 'check-circle' : 'lock'" [size]="18" />
            {{ op.hse.validatedAt ? 'Contrôles validés le ' + dateDe(op.hse.validatedAt) : 'Contrôles non validés' }}
          </p>
          @if (bloquants(op) > 0) {
            <p class="mt-1.5 text-[15px] font-semibold text-crit">
              {{ bloquants(op) }} point(s) bloquant(s) encore en souffrance.
            </p>
          }
        </div>

        @for (c of op.hse.checks; track c.id) {
          <a class="t-card mt-3" [routerLink]="['/terrain/operation', op.id, 'checklist', c.id]">
            <div class="flex items-center justify-between gap-3">
              <span class="t-code text-[15px]">{{ c.phase }}</span>
              <erp-icon name="chevron-right" [size]="22" class="text-ink-faint" />
            </div>
            <p class="mt-1.5 text-[15px] text-ink-soft">
              {{ c.itemsTotal - c.itemsPending }} / {{ c.itemsTotal }} points renseignés
            </p>
            @if (c.blockingPending > 0) {
              <p class="mt-1 text-[15px] font-semibold text-crit">
                {{ c.blockingPending }} bloquant(s) non levé(s)
              </p>
            }
            <p class="mt-1 text-[14px]" [class]="c.validatedAt ? 'text-ok font-semibold' : 'text-ink-muted'">
              {{ c.validatedAt ? 'Validée le ' + dateDe(c.validatedAt) : 'Non validée' }}
            </p>
          </a>
        }

        <a class="t-btn-ghost mt-3" [routerLink]="['/terrain/operation', op.id, 'checklist']">
          <erp-icon name="plus" [size]="18" />
          Ouvrir une checklist sur une phase
        </a>

        <!-- ======================= Le travail ======================= -->
        <p class="t-section">Ce que je fais ici</p>
        <div class="grid gap-3">
          <a class="t-btn-ghost" [routerLink]="['/terrain/operation', op.id, 'releve']">
            <erp-icon name="gauge" [size]="18" />
            Relever un volume
          </a>
          <a class="t-btn-ghost" [routerLink]="['/terrain/operation', op.id, 'incident']">
            <erp-icon name="alert-triangle" [size]="18" />
            Déclarer un incident
          </a>
          <a class="t-btn-ghost" [routerLink]="['/terrain/operation', op.id, 'avancement']">
            <erp-icon name="arrow-right" [size]="18" />
            Faire avancer l’opération
          </a>
          <!-- N'apparaît qu'au moment où la clôture a un sens : avant la
               livraison, un bon de livraison n'aurait rien à décrire. Le
               serveur tient la même règle (STATUTS_CLOTURABLES) — ce n'est
               ici qu'un raccourci d'affichage, jamais l'autorité. -->
          @if (clotureAccessible(op)) {
            <a class="t-btn-ghost" [routerLink]="['/terrain/operation', op.id, 'cloture']">
              <erp-icon name="check-circle" [size]="18" />
              Clôturer l’opération
            </a>
          }
          <!-- Le lien n'apparaît que si un site est RÉFÉRENCÉ. Toutes les
               opérations n'en désignent pas — certaines livrent à une adresse
               en clair — et le serveur refuse alors la fiche, à juste titre.
               Proposer le lien quand même enverrait l'agent dans une impasse
               au moment où il cherche les consignes de sécurité du site. -->
          @if (op.site) {
            <a class="t-btn-ghost" [routerLink]="['/terrain/operation', op.id, 'site']">
              <erp-icon name="shield" [size]="18" />
              Site, accès et consignes
            </a>
          }
        </div>

        <!-- ======================= Le dossier ======================= -->
        <p class="t-section">Produit</p>
        <div class="rounded-[3px] border border-rule-strong bg-surface px-4">
          <div class="t-row"><span class="t-key">Produit</span><span class="t-val">{{ op.product.name }}</span></div>
          <div class="t-row"><span class="t-key">Code</span><span class="t-val font-mono">{{ op.product.code }}</span></div>
          <div class="t-row"><span class="t-key">Densité 15 °C</span><span class="t-val tabular">{{ op.product.referenceDensity15 }}</span></div>
          @if (op.product.viscosityCst !== null) {
            <div class="t-row"><span class="t-key">Viscosité cSt</span><span class="t-val tabular">{{ op.product.viscosityCst }}</span></div>
          }
          @if (op.product.flashPointC !== null) {
            <div class="t-row"><span class="t-key">Point éclair °C</span><span class="t-val tabular">{{ op.product.flashPointC }}</span></div>
          }
          @if (op.product.maxSulphurPct !== null) {
            <div class="t-row"><span class="t-key">Soufre max %</span><span class="t-val tabular">{{ op.product.maxSulphurPct }}</span></div>
          }
        </div>

        <p class="t-section">Volumes et trajet</p>
        <div class="rounded-[3px] border border-rule-strong bg-surface px-4">
          <div class="t-row">
            <span class="t-key">Volume prévu</span>
            <span class="t-val tabular">{{ op.plannedVolume }} <span class="t-code">{{ op.uom }}</span></span>
          </div>
          <div class="t-row"><span class="t-key">Origine</span><span class="t-val">{{ op.originLocation }}</span></div>
          <div class="t-row"><span class="t-key">Destination</span><span class="t-val">{{ op.destinationLocation }}</span></div>
          <div class="t-row"><span class="t-key">Chargement prévu</span><span class="t-val">{{ dateDe(op.plannedLoadingDate) }}</span></div>
          <div class="t-row"><span class="t-key">Chargement réel</span><span class="t-val">{{ dateDe(op.actualLoadingDate) }}</span></div>
          <div class="t-row"><span class="t-key">Livraison réelle</span><span class="t-val">{{ dateDe(op.actualDischargeDate) }}</span></div>
        </div>

        <p class="t-section">Moyens affectés</p>
        @if (op.means) {
          <div class="rounded-[3px] border border-rule-strong bg-surface px-4">
            <div class="t-row"><span class="t-key">Transporteur</span><span class="t-val">{{ op.means.carrierName ?? '-' }}</span></div>
            <div class="t-row"><span class="t-key">Immatriculation</span><span class="t-val font-mono">{{ op.means.vehicleRegistration ?? '-' }}</span></div>
            <div class="t-row"><span class="t-key">Identifiant véhicule</span><span class="t-val font-mono">{{ op.means.vehicleIdentifier ?? '-' }}</span></div>
            <div class="t-row"><span class="t-key">Chauffeur</span><span class="t-val">{{ op.means.driverName ?? '-' }}</span></div>
            <div class="t-row">
              <span class="t-key">Téléphone</span>
              <span class="t-val">
                @if (op.means.driverPhone) {
                  <a class="text-primary underline underline-offset-2" [href]="'tel:' + op.means.driverPhone">
                    {{ op.means.driverPhone }}
                  </a>
                } @else { - }
              </span>
            </div>
          </div>
          <p class="t-hint">
            Ces trois identités sont ce que vous confrontez physiquement au camion et au
            chauffeur qui se présentent.
          </p>
        } @else {
          <p class="t-hint">Aucun moyen n’est encore affecté à cette opération.</p>
        }

        <p class="t-section">Relevés</p>
        @if (op.measurements.length === 0) {
          <p class="t-hint">Aucun relevé enregistré.</p>
        } @else {
          @for (m of op.measurements; track m.measurementDate) {
            <div class="t-card">
              <p class="text-[15px] font-semibold text-ink">{{ dateHeureDe(m.measurementDate) }}</p>
              <p class="mt-1 text-[15px] text-ink-soft">
                Chargé <span class="tabular font-semibold text-ink">{{ m.loadedVolume15 }}</span> ·
                Livré <span class="tabular font-semibold text-ink">{{ m.dischargedVolume15 }}</span>
                <span class="t-code ml-1">{{ m.uom }}</span>
              </p>
              <p class="mt-1 text-[15px] text-ink-soft">
                Température {{ m.observedTempC ?? '-' }} °C
              </p>
              @if (m.isOffSpec) {
                <p class="mt-1 text-[15px] font-semibold text-crit">Hors spécification</p>
              }
            </div>
          }
        }

        <p class="t-section">Incidents</p>
        @if (op.incidents.length === 0) {
          <p class="t-hint">Aucun incident déclaré sur cette opération.</p>
        } @else {
          @for (i of op.incidents; track i.reference) {
            <div class="t-card">
              <p class="font-mono text-[14px] font-bold text-gray-900">{{ i.reference }}</p>
              <p class="mt-1 text-[16px] font-semibold text-ink">{{ i.title }}</p>
              <p class="mt-1 flex flex-wrap gap-2">
                <span class="t-code">{{ i.type }}</span>
                <span class="t-code">{{ i.severity }}</span>
                <span class="text-[14px] text-ink-muted">{{ dateHeureDe(i.occurredAt) }}</span>
              </p>
            </div>
          }
        }

        <p class="t-section">Documents de l’opération</p>
        @if (op.documents.length === 0) {
          <p class="t-hint">Aucune pièce produite pour l’instant.</p>
        } @else {
          @for (d of op.documents; track d.id) {
            <div class="t-card">
              <p class="font-mono text-[14px] font-bold text-gray-900">{{ d.reference }}</p>
              <p class="mt-1"><span class="t-code">{{ d.kind }}</span></p>
              <p class="mt-1 text-[14px] text-ink-muted">
                Produit le {{ dateDe(d.generatedAt) }}{{ d.isSealed ? ' · scellé' : '' }}
              </p>
            </div>
          }
        }

        <p class="t-section">Pièces du client visibles du terrain</p>
        @if (op.referenceDocuments.length === 0) {
          <p class="t-hint">Aucune pièce du client n’est ouverte au terrain.</p>
        } @else {
          @for (d of op.referenceDocuments; track d.id) {
            <div class="t-card">
              <p class="text-[16px] font-semibold text-ink">{{ d.title }}</p>
              <p class="mt-1"><span class="t-code">{{ d.type }}</span></p>
              <p class="mt-1 text-[14px]" [class]="expiree(d.expiryDate) ? 'font-semibold text-crit' : 'text-ink-muted'">
                {{ d.expiryDate ? 'Échéance ' + dateDe(d.expiryDate) : 'Sans échéance' }}
              </p>
            </div>
          }
        }
      }
    </div>
  `,
})
export class TerrainOperationComponent implements OnInit {
  private readonly api = inject(FieldApiService);

  /** Lié par `withComponentInputBinding()` — le paramètre de route `id`. */
  @Input() id = '';

  protected readonly operation = signal<FieldOperationDetail | null>(null);
  protected readonly chargement = signal(true);
  protected readonly erreur = signal<string | null>(null);

  protected readonly dateDe = jour;
  protected readonly dateHeureDe = jourHeure;

  ngOnInit(): void {
    this.api.operation(this.id).subscribe({
      next: (d) => {
        this.operation.set(d);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messageDeRefus(e, 'Opération inaccessible.'));
      },
    });
  }

  /** Total des points bloquants non levés, tel que le serveur les compte. */
  protected bloquants(op: FieldOperationDetail): number {
    return op.hse.checks.reduce((total, c) => total + c.blockingPending, 0);
  }

  /**
   * Miroir d'affichage de `STATUTS_CLOTURABLES` côté serveur.
   *
   * Reste visible si les pièces existent déjà, même si le statut a depuis
   * avancé : signer reste possible tant que l'opération n'est pas CLOSED, et
   * l'agent ne doit pas perdre son chemin vers un bon de livraison à moitié
   * signé.
   */
  protected clotureAccessible(op: FieldOperationDetail): boolean {
    if (op.status === 'DELIVERING' || op.status === 'FINAL_CHECK') return true;
    return op.documents.some((d) => d.kind === 'OPERATION_REPORT' || d.kind === 'DELIVERY_NOTE');
  }

  protected expiree(iso: string | null): boolean {
    return iso !== null && iso.slice(0, 10) < new Date().toISOString().slice(0, 10);
  }
}
