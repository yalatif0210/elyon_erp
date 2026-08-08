import { SettingsService } from './settings.service';

/** Fenêtre de comptage commune aux deux plafonds : une minute. */
export const RATE_WINDOW_MS = 60_000;

/** Valeurs de repli — celles d'aujourd'hui, si la base ne dit rien. */
export const RATE_DEFAULTS = { api: 120, login: 30 } as const;

/**
 * Plafonds de limitation de débit, LUS AU DÉMARRAGE (§ 1.4).
 *
 * ⚠️ CES DEUX PARAMÈTRES NE PRENNENT EFFET QU'AU REDÉMARRAGE DE L'API, et
 *    leur description en base le dit à celui qui les modifie. Le
 *    ThrottlerModule construit sa configuration une seule fois, à l'amorçage :
 *    lui faire relire la base à chaque requête supposerait de réécrire le
 *    guard, pour un réglage qu'on touche une fois par an.
 *
 * Le plafond de connexion transite par un relais mutable parce que le
 * décorateur @Throttle du contrôleur d'authentification est évalué à l'IMPORT
 * du module, bien avant que la base ne soit joignable. Le décorateur ne lui
 * passe donc pas un nombre mais la fonction `loginRateLimit` — que le
 * throttler résout à chaque requête, quand la valeur lue au démarrage est en
 * place. Une constante mutée après coup, elle, ne serait jamais relue : le
 * décorateur fige le nombre qu'on lui donne.
 */
let loginRatePerMinute: number = RATE_DEFAULTS.login;

export function loginRateLimit(): number {
  return loginRatePerMinute;
}

/**
 * Lit les deux plafonds et arme le relais de connexion.
 * Appelé par la factory du ThrottlerModule, une fois, au démarrage.
 */
export async function primeRateLimits(
  settings: SettingsService,
): Promise<{ api: number; login: number }> {
  const [api, login] = await Promise.all([
    settings.number('API_RATE_PER_MINUTE', RATE_DEFAULTS.api),
    settings.number('LOGIN_RATE_PER_MINUTE', RATE_DEFAULTS.login),
  ]);
  loginRatePerMinute = positiveLimit(login, RATE_DEFAULTS.login);
  return { api: positiveLimit(api, RATE_DEFAULTS.api), login: loginRatePerMinute };
}

/**
 * Un plafond nul, négatif ou fractionnaire n'est pas une politique de débit :
 * à 0, l'API se refuse à tout le monde, y compris à la sonde de santé — et le
 * conteneur se fait redémarrer en boucle sans que personne ne comprenne
 * pourquoi. On retient le défaut.
 */
function positiveLimit(value: number, fallback: number): number {
  const rounded = Math.floor(value);
  return rounded >= 1 ? rounded : fallback;
}
