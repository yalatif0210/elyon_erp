import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Jeu d'icônes minimal, tracés Lucide.
 *
 * Elles ne sont pas décoratives : la règle d'accessibilité du § 17.2 impose
 * qu'un statut porte TOUJOURS couleur + icône + libellé. Un utilisateur qui ne
 * distingue pas le rouge du vert doit pouvoir lire un blocage.
 */
export type IconName =
  | 'camera'
  | 'check-circle'
  | 'clock'
  | 'truck'
  | 'lock'
  | 'alert-triangle'
  | 'shield'
  | 'file-text'
  | 'users'
  | 'layers'
  | 'log-out'
  | 'search'
  | 'gauge'
  | 'ban'
  | 'briefcase'
  | 'receipt'
  | 'clipboard-check'
  | 'chevron-right'
  | 'plus'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'x';

const PATHS: Record<IconName, string> = {
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  truck:
    'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M14 9h4l4 4v4a1 1 0 0 1-1 1h-2M7 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM7 11V7a5 5 0 0 1 10 0v4',
  'alert-triangle':
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z',
  'file-text':
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v5h5M16 13H8M16 17H8M10 9H8',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  layers:
    'm12.83 2.18 8.34 4.17a1 1 0 0 1 0 1.79l-8.34 4.17a2 2 0 0 1-1.66 0L2.83 8.14a1 1 0 0 1 0-1.79l8.34-4.17a2 2 0 0 1 1.66 0ZM2 12.5l9.17 4.59a2 2 0 0 0 1.66 0L22 12.5M2 17.5l9.17 4.59a2 2 0 0 0 1.66 0L22 17.5',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  gauge: 'm12 14 4-4M3.34 19a10 10 0 1 1 17.32 0',
  camera:
    'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM4.93 4.93l14.14 14.14',
  briefcase:
    'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  receipt:
    'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8H8M16 12H8M13 16H8',
  'clipboard-check':
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM9 14l2 2 4-4',
  'chevron-right': 'm9 18 6-6-6-6',
  plus: 'M12 5v14M5 12h14',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  // Réordonnancement d'une séquence : la flèche dit le sens, le libellé
  // adjacent dit l'effet. Une icône seule ne suffit jamais (§ 17.2).
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  x: 'M18 6 6 18M6 6l12 12',
};

@Component({
  selector: 'erp-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="shrink-0"
    >
      <path [attr.d]="path" />
    </svg>
  `,
})
export class IconComponent {
  @Input({ required: true }) set name(value: IconName) {
    this.path = PATHS[value] ?? '';
  }
  @Input() size = 16;
  protected path = '';
}
