import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FieldApiService, FieldSiteSheet } from '../../core/field-api.service';
import { messageDeRefus } from '../../core/field-queue.service';
import { IconComponent } from '../../shared/icon.component';
import { jour, jourHeure } from './terrain-libelles';

/**
 * FICHE DU SITE — accès, consignes, contacts, passé.
 *
 * L'historique est celui du SITE et non du client : deux dépôts d'un même
 * groupe n'ont ni les mêmes consignes ni les mêmes incidents. Le serveur le
 * dérive de l'opération affectée, jamais d'un identifiant de site choisi par
 * l'appelant — l'écran n'a donc rien à sélectionner.
 *
 * Les consignes de sécurité et d'accès sont placées AVANT l'adresse : c'est ce
 * qu'on relit devant la barrière, pas ce qu'on cherche en roulant.
 */
@Component({
  selector: 'terrain-site',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="t-screen">
      <a
        [routerLink]="['/terrain/operation', id]"
        class="inline-flex min-h-[52px] items-center gap-1.5 text-[15px] font-semibold text-primary"
      >
        <erp-icon name="arrow-right" [size]="17" class="rotate-180" />
        Dossier de l’opération
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

      @if (fiche(); as f) {
        <h1 class="t-title mt-2">{{ f.site.name }}</h1>
        <p class="t-sub">{{ f.clientLegalName }} · <span class="font-mono">{{ f.site.code }}</span></p>

        <!-- ============ Ce que le site exige ============
             EN PREMIER, avant tout le reste. C'est ce qui décide si le camion
             franchit la barrière : un badge non retiré ou un créneau manqué
             se solde par un retour à vide, produit déjà payé. L'agent doit le
             lire avant de partir, pas en arrivant. -->
        @if (f.requirements.length > 0) {
          <p class="t-section">Ce que ce site exige</p>
          @for (e of f.requirements; track e.label) {
            <div
              class="mt-2 rounded-[3px] border p-4"
              [class]="e.isBlocking ? 'border-crit/40 bg-crit-wash' : 'border-rule-strong bg-surface'"
            >
              <p class="flex items-start justify-between gap-3">
                <span class="text-[17px] font-semibold leading-snug"
                      [class]="e.isBlocking ? 'text-crit' : 'text-ink'">
                  {{ e.label }}
                </span>
                @if (e.isBlocking) {
                  <span class="inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-crit px-2
                               py-1 text-[12px] font-semibold uppercase tracking-wide text-white">
                    <erp-icon name="lock" [size]="12" />
                    Bloquant
                  </span>
                }
              </p>
              <p class="mt-1.5 text-[15px] leading-relaxed"
                 [class]="e.isBlocking ? 'text-crit' : 'text-ink-soft'">
                {{ e.detail }}
              </p>
              @if (e.description) {
                <p class="mt-1 text-[14px] leading-snug text-ink-muted">{{ e.description }}</p>
              }
            </div>
          }
        }

        @if (f.site.safetyInstructions) {
          <p class="t-section">Consignes de sécurité</p>
          <div class="rounded-[3px] border-l-[6px] border-crit bg-crit-wash p-4">
            <p class="whitespace-pre-line text-[16px] leading-relaxed text-ink">
              {{ f.site.safetyInstructions }}
            </p>
          </div>
        }

        @if (f.site.accessInstructions) {
          <p class="t-section">Accès</p>
          <div class="rounded-[3px] border border-rule-strong bg-surface p-4">
            <p class="whitespace-pre-line text-[16px] leading-relaxed text-ink">
              {{ f.site.accessInstructions }}
            </p>
          </div>
        }

        <p class="t-section">Adresse et horaires</p>
        <div class="rounded-[3px] border border-rule-strong bg-surface px-4">
          <div class="t-row"><span class="t-key">Adresse</span><span class="t-val">{{ f.site.addressLine ?? '—' }}</span></div>
          <div class="t-row"><span class="t-key">Ville</span><span class="t-val">{{ f.site.city ?? '—' }}</span></div>
          <div class="t-row"><span class="t-key">Pays</span><span class="t-val font-mono">{{ f.site.countryCode }}</span></div>
          <div class="t-row"><span class="t-key">Horaires</span><span class="t-val">{{ f.site.openingHours ?? '—' }}</span></div>
          <div class="t-row">
            <span class="t-key">Risque par défaut</span>
            <span class="t-val"><span class="t-code">{{ f.site.defaultHseRiskLevel }}</span></span>
          </div>
        </div>

        @if (f.site.latitude !== null && f.site.longitude !== null) {
          <!-- Lien géographique et non carte embarquée : le CSP interdit toute
               ressource externe, et une carte muette vaudrait moins qu'un
               renvoi vers l'application de navigation de la tablette. -->
          <a
            class="t-btn-ghost mt-3"
            [href]="'geo:' + f.site.latitude + ',' + f.site.longitude"
            rel="noopener"
          >
            <erp-icon name="arrow-right" [size]="18" />
            Ouvrir dans la navigation ({{ f.site.latitude }}, {{ f.site.longitude }})
          </a>
        }

        <p class="t-section">Contacts sur place</p>
        @if (f.contacts.length === 0) {
          <p class="t-hint">
            Aucun contact n’est ouvert au terrain pour ce site. Un contact n’est pas visible ici
            parce qu’il est contact, mais parce que quelqu’un l’a décidé.
          </p>
        } @else {
          @for (c of f.contacts; track c.fullName) {
            <div class="t-card">
              <p class="text-[16px] font-semibold text-ink">{{ c.fullName }}</p>
              @if (c.role) { <p class="mt-0.5 text-[15px] text-ink-soft">{{ c.role }}</p> }
              @if (c.phone) {
                <a class="mt-2 inline-flex min-h-[52px] items-center text-[16px] font-semibold text-primary underline underline-offset-2"
                   [href]="'tel:' + c.phone">{{ c.phone }}</a>
              }
              @if (c.email) { <p class="text-[15px] text-ink-muted">{{ c.email }}</p> }
            </div>
          }
        }

        <p class="t-section">Ce qui s’est passé ici</p>
        @if (f.history.length === 0) {
          <p class="t-hint">Aucun passage antérieur enregistré sur ce site.</p>
        } @else {
          @for (h of f.history; track h.reference) {
            <div class="t-card">
              <div class="flex items-start justify-between gap-3">
                <p class="font-mono text-[15px] font-bold text-gray-900">{{ h.reference }}</p>
                <span class="t-code">{{ h.status }}</span>
              </div>
              <p class="mt-1 text-[15px] text-ink-soft">{{ dateDe(h.date) }}</p>
              <p class="mt-1 text-[15px] text-ink-soft">
                Prévu <span class="tabular font-semibold text-ink">{{ h.plannedVolume }}</span> ·
                Livré
                <span class="tabular font-semibold text-ink">{{ h.deliveredVolume ?? '—' }}</span>
                <span class="t-code ml-1">{{ h.uom }}</span>
              </p>
              @for (i of h.incidents; track i.reference) {
                <p class="mt-1.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-crit">
                  <erp-icon name="alert-triangle" [size]="15" />
                  {{ i.title }}
                  <span class="t-code">{{ i.severity }}</span>
                  <span class="text-[14px] font-normal text-ink-muted">{{ dateHeureDe(i.occurredAt) }}</span>
                </p>
              }
            </div>
          }
        }
      }
    </div>
  `,
})
export class TerrainSiteComponent implements OnInit {
  private readonly api = inject(FieldApiService);

  @Input() id = '';

  protected readonly fiche = signal<FieldSiteSheet | null>(null);
  protected readonly chargement = signal(true);
  protected readonly erreur = signal<string | null>(null);

  protected readonly dateDe = jour;
  protected readonly dateHeureDe = jourHeure;

  ngOnInit(): void {
    this.api.site(this.id).subscribe({
      next: (f) => {
        this.fiche.set(f);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        // Le serveur distingue « pas de site référencé » de « hors périmètre »
        // par un message rédigé : on l'affiche intégralement plutôt que de le
        // remplacer par une formule générique.
        this.erreur.set(messageDeRefus(e, 'Fiche de site indisponible.'));
      },
    });
  }
}
