import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, DealRow, QuotationRequestRow } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';

const DEAL_STATUS_LABEL: Record<string, string> = {
  PROFORMA_SENT: 'Proforma envoyée : en attente de votre acceptation',
  CUSTOMER_ACCEPTED: 'Acceptée',
  IN_EXECUTION: 'En cours d’exécution',
  DELIVERED: 'Livrée',
  PARTIALLY_DELIVERED: 'Partiellement livrée',
  INVOICED: 'Facturée',
  CLOSED: 'Clôturée',
};

/**
 * Tableau de bord — ce qui réclame une action, avant tout le reste.
 *
 * Une proforma envoyée et jamais acceptée est la SEULE chose que ce compte
 * peut décider seul (§ 13) : c'est donc ce que l'écran met en avant, pas un
 * résumé générique.
 */
@Component({
  selector: 'erp-portal-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Tableau de bord</h1>
      <p class="page-sub">Vue d'ensemble de votre activité auprès d'Elyon Trading.</p>
    </header>

    <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div class="card stat">
        <span class="stat-label">Demandes de cotation</span>
        <span class="stat-value">{{ quotations().length }}</span>
        <span class="stat-note">au total</span>
      </div>
      <div class="card stat">
        <span class="stat-label">Affaires en cours</span>
        <span class="stat-value">{{ dealsTotal() }}</span>
      </div>
      <div class="card stat">
        <span class="stat-label">À accepter</span>
        <span class="stat-value" [class.text-crit]="aAccepter().length > 0">{{ aAccepter().length }}</span>
        <span class="stat-note">proforma en attente</span>
      </div>
      <div class="card stat">
        <span class="stat-label">Factures</span>
        <span class="stat-value">{{ invoicesTotal() }}</span>
      </div>
    </div>

    @if (aAccepter().length > 0) {
      <section class="card mb-6 overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Proformas en attente de votre acceptation</h2>
        </div>
        <div class="card-body">
          <table class="table">
            <thead>
              <tr>
                <th>Affaire</th>
                <th>Produit</th>
                <th class="num">Volume</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (d of aAccepter(); track d.id) {
                <tr>
                  <td class="ref">{{ d.reference }}</td>
                  <td class="text-ink-soft">{{ d.product.name }}</td>
                  <td class="num font-mono text-ink-soft">{{ grouper(+d.contractedVolume) }} {{ d.uom }}</td>
                  <td>
                    <a [routerLink]="['/affaires', d.id]" class="link text-[12px]">Consulter →</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (recentDeals().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">
          Aucune affaire pour le moment. Déposez une
          <a routerLink="/devis" class="link">demande de cotation</a> pour commencer.
        </p>
      </div>
    } @else {
      <section class="card overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Affaires récentes</h2>
          <a routerLink="/affaires" class="link text-[12px]">Tout voir →</a>
        </div>
        <div class="card-body !p-0">
          <table class="table">
            <thead>
              <tr>
                <th>Affaire</th>
                <th>Produit</th>
                <th>Statut</th>
                <th class="num">Volume</th>
              </tr>
            </thead>
            <tbody>
              @for (d of recentDeals(); track d.id) {
                <tr>
                  <td class="ref">{{ d.reference }}</td>
                  <td class="text-ink-soft">{{ d.product.name }}</td>
                  <td class="text-ink-soft">{{ label(d.status) }}</td>
                  <td class="num font-mono text-ink-soft">{{ grouper(+d.contractedVolume) }} {{ d.uom }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 3 });
  protected readonly chargement = signal(true);
  protected readonly quotations = signal<QuotationRequestRow[]>([]);
  protected readonly recentDeals = signal<DealRow[]>([]);
  protected readonly dealsTotal = signal(0);
  protected readonly invoicesTotal = signal(0);
  protected readonly aAccepter = signal<DealRow[]>([]);

  protected label(status: string): string {
    return DEAL_STATUS_LABEL[status] ?? status;
  }

  ngOnInit(): void {
    this.api.quotations().subscribe((q) => this.quotations.set(q));
    this.api.invoices({ pageSize: 1 }).subscribe((p) => this.invoicesTotal.set(p.total));
    this.api.deals({ pageSize: 10 }).subscribe((p) => {
      this.chargement.set(false);
      this.dealsTotal.set(p.total);
      this.recentDeals.set(p.items);
      this.aAccepter.set(p.items.filter((d) => d.status === 'PROFORMA_SENT'));
    });
  }
}
