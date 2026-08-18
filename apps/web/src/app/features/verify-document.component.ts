import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';

const KIND_LABELS: Record<string, string> = {
  PROFORMA: 'Proforma',
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  DELIVERY_NOTE: 'Bon de livraison',
  OPERATION_REPORT: 'Rapport d’exécution',
  TRANSPORT_ORDER: 'Ordre de transport',
  MEASUREMENT_REPORT: 'Rapport de mesure',
};

interface Resultat {
  valid: boolean;
  message: string;
  kind?: string;
  reference?: string;
  sha256?: string;
  generatedAt?: string;
  sealed?: boolean;
  sealedAt?: string | null;
  superseded?: string | null;
}

/**
 * Vérification publique d'un document par QR code (§ 12.2).
 *
 * ⚠️ CORRIGÉ — CETTE PAGE N'EXISTAIT PAS.
 *
 *    Chaque PDF scellé imprime un QR code depuis le début de la session
 *    (`pdf.processor.ts`), pointant vers une route déjà publique
 *    (`GET /api/internal/documents/verify/:token`, `@Public()`). Scanner ce
 *    code n'ouvrait donc rien : la promesse imprimée sur le papier n'avait
 *    aucune page derrière elle.
 *
 * PAGE HORS SESSION - aucun compte requis, aucun `authGuard`. Ce que le
 * jeton révèle est volontairement minimal (§ commentaire du service) :
 * nature de la pièce, référence, empreinte, statut - jamais un montant, un
 * client ou une marge.
 */
@Component({
  selector: 'erp-verify-document',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div class="w-full max-w-md">
        <div class="mb-5 flex items-center justify-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-[3px] bg-primary text-white">
            <erp-icon name="layers" [size]="17" />
          </div>
          <span class="font-display text-[16px] font-bold tracking-[-0.01em] text-headline">
            Elyon Trading
          </span>
        </div>

        <div class="card overflow-hidden">
          <div class="card-body text-center">
            @if (chargement()) {
              <p class="py-6 text-[13px] text-ink-muted">Vérification…</p>
            } @else if (resultat()) {
              @let r = resultat()!;
              @if (r.valid) {
                <erp-icon
                  [name]="r.superseded ? 'alert-triangle' : 'check-circle'"
                  [size]="32"
                  [class]="r.superseded ? 'mx-auto text-warn-ink' : 'mx-auto text-ok'"
                />
                <p
                  class="mt-3 text-[15px] font-semibold"
                  [class]="r.superseded ? 'text-warn-ink' : 'text-ok'"
                >
                  {{ r.message }}
                </p>
                <dl class="mt-5 space-y-2 text-left text-[13px]">
                  <div class="flex justify-between border-b border-rule pb-2">
                    <dt class="text-ink-muted">Nature</dt>
                    <dd class="font-medium text-ink">{{ kindLabel(r.kind) }}</dd>
                  </div>
                  <div class="flex justify-between border-b border-rule pb-2">
                    <dt class="text-ink-muted">Référence</dt>
                    <dd class="font-mono text-ink">{{ r.reference }}</dd>
                  </div>
                  <div class="flex justify-between border-b border-rule pb-2">
                    <dt class="text-ink-muted">Générée le</dt>
                    <dd class="text-ink">{{ jour(r.generatedAt) }}</dd>
                  </div>
                  @if (r.sealed) {
                    <div class="flex justify-between border-b border-rule pb-2">
                      <dt class="text-ink-muted">Scellée le</dt>
                      <dd class="text-ink">{{ jour(r.sealedAt) }}</dd>
                    </div>
                  }
                  <div class="pb-1">
                    <dt class="mb-1 text-ink-muted">Empreinte SHA-256</dt>
                    <dd class="break-all font-mono text-[11px] text-ink-soft">{{ r.sha256 }}</dd>
                  </div>
                </dl>
              } @else {
                <erp-icon name="x" [size]="32" class="mx-auto text-crit" />
                <p class="mt-3 text-[15px] font-semibold text-crit">{{ r.message }}</p>
              }
            }
          </div>
        </div>

        <p class="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
          Cette vérification confronte l’empreinte du papier présenté à ce que le système a
          réellement émis. Elle ne révèle ni montant, ni client, ni marge.
        </p>
      </div>
    </div>
  `,
})
export class VerifyDocumentComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly chargement = signal(true);
  protected readonly resultat = signal<Resultat | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.resultat.set({ valid: false, message: 'Jeton absent.' });
      this.chargement.set(false);
      return;
    }
    this.api.verifyDocument(token).subscribe({
      next: (r) => {
        this.resultat.set(r);
        this.chargement.set(false);
      },
      error: () => {
        this.resultat.set({ valid: false, message: 'Vérification impossible pour le moment.' });
        this.chargement.set(false);
      },
    });
  }

  protected kindLabel(k?: string): string {
    return (k && KIND_LABELS[k]) ?? k ?? '-';
  }

  protected jour(d?: string | null): string {
    return d ? d.slice(0, 10) : '-';
  }
}
