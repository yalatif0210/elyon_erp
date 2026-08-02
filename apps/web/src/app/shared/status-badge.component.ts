import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { IconComponent, IconName } from './icon.component';

export type StatusKind = 'ok' | 'wait' | 'transit' | 'blocked' | 'neutral';

const ICONS: Record<StatusKind, IconName> = {
  ok: 'check-circle',
  wait: 'clock',
  transit: 'truck',
  blocked: 'lock',
  neutral: 'file-text',
};

const CLASSES: Record<StatusKind, string> = {
  ok: 'badge-ok',
  wait: 'badge-wait',
  transit: 'badge-transit',
  blocked: 'badge-blocked',
  neutral: 'badge-neutral',
};

/**
 * Badge de statut — SPECIFICATIONS.md § 17.2.
 *
 * RÈGLE STRICTE : couleur + icône + libellé, toujours les trois. Le composant
 * rend impossible d'afficher un statut par la seule teinte, ce qui serait un
 * risque opérationnel sur un verrou de sécurité.
 */
@Component({
  selector: 'erp-status-badge',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span [class]="cssClass()">
      <erp-icon [name]="icon()" [size]="12" />
      {{ label }}
    </span>
  `,
})
export class StatusBadgeComponent {
  @Input({ required: true }) label = '';

  @Input({ required: true }) set kind(value: StatusKind) {
    this.kindSignal.set(value);
  }

  private readonly kindSignal = signal<StatusKind>('neutral');
  protected readonly icon = computed(() => ICONS[this.kindSignal()]);
  protected readonly cssClass = computed(() => CLASSES[this.kindSignal()]);
}
