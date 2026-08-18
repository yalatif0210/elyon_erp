import { UserRole } from '@prisma/client';

/**
 * Registre des écrans - SOURCE UNIQUE (§ paramétrage 17/08).
 *
 * Avant cette table, le même triplet (écran, rôles) vivait à trois endroits
 * tenus à la main : le menu (`shell.component.ts`), le garde de route
 * (`app.routes.ts`), et le `@Roles()` du contrôleur. Les trois pouvaient
 * diverger sans qu'aucune erreur ne le signale. Ce registre - et la table
 * `RoleScreenAccess` qui le surcharge - devient la seule vérité : le menu et
 * les gardes de route interrogent `GET /screen-access/me`, plus aucun des
 * deux ne porte sa propre liste de rôles.
 *
 * ⚠️ LES VALEURS CI-DESSOUS SONT CELLES DU BACKEND, PAS CELLES DU MENU.
 *
 *    `shell.component.ts` déclarait plusieurs écrans « ouverts à tous »
 *    (affaires, opérations, facturation, HSE, documents, tiers,
 *    paramétrage...) alors que leur route de lecture réelle exclut déjà
 *    IT_ADMIN et parfois d'autres rôles. Le menu mentait sans qu'aucune
 *    erreur ne le signale - exactement le symptôme que ce registre corrige.
 *    Les valeurs ici sont recopiées du `@Roles()` effectif de la route
 *    posée en `@Screen()`, vérifié le 17/08/2026.
 *
 * `defaultRoles: null` = tous les rôles internes, par défaut (mais un
 * `MASQUE` explicite peut toujours retirer un rôle précis).
 */
export interface ScreenDef {
  key: string;
  label: string;
  group: 'Piloter' | 'Vendre et livrer' | 'Administrer';
  defaultRoles: UserRole[] | null;
}

const R = UserRole;

export const SCREEN_REGISTRY: ScreenDef[] = [
  // --- Piloter ---
  { key: 'tableau-de-bord', label: 'Tableau de bord', group: 'Piloter', defaultRoles: null },
  { key: 'mes-taches', label: 'Ce que j’ai à traiter', group: 'Piloter', defaultRoles: null },
  {
    key: 'pilotage',
    label: 'Pilotage financier',
    group: 'Piloter',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.CCOO, R.ACCOUNTANT, R.LOGISTICS_COORD],
  },
  {
    key: 'supervision',
    label: 'Surveillance',
    group: 'Piloter',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.CCOO, R.ACCOUNTANT, R.IT_ADMIN],
  },
  {
    key: 'recouvrement',
    label: 'Recouvrement',
    group: 'Piloter',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.ACCOUNTANT],
  },

  // --- Vendre et livrer ---
  {
    key: 'crm',
    label: 'Pipeline commercial',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.SALES_REP, R.FINANCE_CFO, R.ASSISTANT_DG],
  },
  {
    key: 'demandes-de-cotation',
    label: 'Demandes de cotation',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.SALES_REP, R.ASSISTANT_DG],
  },
  {
    key: 'affaires',
    label: 'Affaires',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.SALES_REP, R.FINANCE_CFO, R.ACCOUNTANT, R.LOGISTICS_COORD, R.ASSISTANT_DG],
  },
  {
    key: 'operations',
    label: 'Opérations',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.LOGISTICS_COORD, R.SALES_REP, R.FINANCE_CFO, R.ACCOUNTANT, R.ASSISTANT_DG],
  },
  {
    key: 'facturation',
    label: 'Facturation',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.FINANCE_CFO, R.ACCOUNTANT, R.SALES_REP, R.ASSISTANT_DG],
  },
  {
    key: 'hse',
    label: 'Contrôles HSE',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.LOGISTICS_COORD, R.ASSISTANT_DG, R.FINANCE_CFO],
  },
  {
    key: 'documents',
    label: 'Documents',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.FINANCE_CFO, R.ACCOUNTANT, R.LOGISTICS_COORD, R.ASSISTANT_DG],
  },
  {
    key: 'achats',
    label: 'Achats',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.ACCOUNTANT, R.CCOO, R.LOGISTICS_COORD],
  },
  {
    key: 'barge',
    label: 'Barge',
    group: 'Vendre et livrer',
    defaultRoles: [R.DG, R.CCOO, R.FINANCE_CFO, R.LOGISTICS_COORD],
  },

  // --- Administrer ---
  {
    key: 'conformite',
    label: 'Conformité',
    group: 'Administrer',
    defaultRoles: [R.DG, R.CCOO, R.LOGISTICS_COORD, R.FINANCE_CFO, R.ASSISTANT_DG],
  },
  {
    key: 'echeancier',
    label: 'Échéancier',
    group: 'Administrer',
    defaultRoles: [R.DG, R.CCOO, R.LOGISTICS_COORD, R.ASSISTANT_DG, R.FINANCE_CFO],
  },
  {
    key: 'tiers',
    label: 'Tiers',
    group: 'Administrer',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.ACCOUNTANT, R.CCOO, R.ASSISTANT_DG, R.SALES_REP, R.LOGISTICS_COORD],
  },
  {
    key: 'derogations',
    label: 'Dérogations',
    group: 'Administrer',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.CCOO, R.ACCOUNTANT, R.ASSISTANT_DG],
  },
  // « Référentiels » n'a qu'une seule route marquée (currencies, ouverte à
  // tous) : les sous-listes plus sensibles (barèmes, seuils de marge)
  // restent hors de la portée de ce registre, gouvernées par leur propre
  // `@Roles()` - voir le commentaire au-dessus de `referentials.controller.ts`.
  { key: 'referentiels', label: 'Référentiels', group: 'Administrer', defaultRoles: null },
  {
    key: 'parametrage',
    label: 'Paramétrage',
    group: 'Administrer',
    defaultRoles: [R.DG, R.FINANCE_CFO, R.ACCOUNTANT, R.CCOO, R.LOGISTICS_COORD, R.SALES_REP, R.IT_ADMIN],
  },
  {
    key: 'journal-audit',
    label: 'Journal d’audit',
    group: 'Administrer',
    defaultRoles: [R.DG, R.IT_ADMIN],
  },
  // « Accès aux écrans » lui-même n'y figure PAS : il reste sur un @Roles(DG)
  // fixe, immunisé contre la table qu'il édite - sans quoi un DG pourrait se
  // verrouiller hors du seul écran qui permet de se rouvrir l'accès.
];

export function screenDefaultRoles(key: string): UserRole[] | null {
  const def = SCREEN_REGISTRY.find((s) => s.key === key);
  return def ? def.defaultRoles : null;
}
