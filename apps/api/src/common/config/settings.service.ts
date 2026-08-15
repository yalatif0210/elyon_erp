import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Durée de vie d'une entrée en cache.
 *
 * Trente secondes est un compromis assumé : ces valeurs sont relues à CHAQUE
 * connexion et à chaque calcul de marge — un aller-retour base par lecture
 * serait du gaspillage pur — mais un réglage corrigé dans l'urgence ne doit
 * pas mettre un quart d'heure à s'appliquer. L'écran de paramétrage vide le
 * cache dès qu'il écrit, ce délai n'est donc qu'un plafond.
 */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  /** `null` signifie « clé absente ou vide » — l'absence se met en cache aussi. */
  value: string | null;
  expiresAt: number;
}

/**
 * Lecture des paramètres de gestion (table `system_settings`).
 *
 * Aucune règle de gestion n'est écrite dans le code : seuils, durées, quotas
 * et listes vivent en base, là où le paramétrage par écran et par import les
 * atteint. Ce service est le SEUL point de lecture — la conversion, le repli
 * et la mise en cache y sont écrits une fois, pas redécouverts à chaque
 * appelant.
 *
 * ⚠️ UN DÉFAUT EXISTE TOUJOURS. Clé supprimée, valeur illisible, base
 *    momentanément injoignable : on retombe sur la valeur d'aujourd'hui. Le
 *    système ne doit jamais se retrouver SANS politique de verrouillage parce
 *    qu'une ligne a disparu — l'absence de règle est plus dangereuse que la
 *    règle mal réglée, et elle ne se voit pas.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valeur numérique. Toute saisie non numérique retombe sur le défaut, avec
   * une trace : un paramètre illisible est une anomalie d'exploitation, pas
   * un cas nominal qu'on avale en silence.
   */
  async number(key: string, fallback: number): Promise<number> {
    const raw = await this.read(key);
    if (raw === null) return fallback;

    // La virgule décimale est ce qu'un tableur francophone produit, et
    // l'import de paramètres accepte le collage direct depuis un tableur.
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      this.logger.warn(`Paramètre ${key} = « ${raw} » n'est pas un nombre — repli sur ${fallback}.`);
      return fallback;
    }
    return parsed;
  }

  /**
   * Valeur textuelle brute — URL, clé, libellé. Une chaîne vide compte comme
   * absente : `SystemSetting.value` ne distingue pas « vide » de « non
   * configuré », et un secret vide ne doit jamais passer pour une valeur.
   */
  async string(key: string, fallback: string): Promise<string> {
    const raw = await this.read(key);
    return raw === null ? fallback : raw;
  }

  /**
   * Valeur booléenne. Seuls `true`/`false` (insensible à la casse) sont
   * reconnus — une valeur illisible retombe sur le défaut, tracée comme pour
   * `number()` : un interrupteur qu'on n'arrive plus à lire ne doit pas
   * basculer en silence.
   */
  async boolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.read(key);
    if (raw === null) return fallback;

    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;

    this.logger.warn(`Paramètre ${key} = « ${raw} » n'est ni true ni false — repli sur ${fallback}.`);
    return fallback;
  }

  /**
   * Liste séparée par des virgules.
   *
   * ⚠️ UNE LISTE VIDE N'EST PAS UNE INTENTION, c'est une cellule effacée. La
   *    prendre au mot désactiverait précisément la règle qu'elle porte :
   *    plus aucun rôle soumis au second facteur, plus aucun poste de coût
   *    exclu du double comptage. On rend le défaut.
   */
  async list(key: string, fallback: string[]): Promise<string[]> {
    const raw = await this.read(key);
    if (raw === null) return fallback;

    const parsed = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (parsed.length === 0) {
      this.logger.warn(`Paramètre ${key} vide — repli sur « ${fallback.join(',')} ».`);
      return fallback;
    }
    return parsed;
  }

  /**
   * Vide le cache — une clé, ou tout si l'appel est nu.
   *
   * Appelé par l'écran de paramétrage après écriture : sans cela, celui qui
   * corrige une valeur la voit sans effet pendant une demi-minute et la
   * ressaisit, en doutant de son geste.
   */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  /**
   * Lecture brute, mise en cache.
   *
   * Une valeur vide est traitée comme une absence : `Number('')` vaut 0, et
   * un plafond de tentatives à 0 verrouillerait tous les comptes dès la
   * première faute de frappe.
   */
  private async read(key: string): Promise<string | null> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    let value: string | null;
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key },
        select: { value: true },
      });
      const trimmed = row?.value.trim() ?? '';
      value = trimmed === '' ? null : trimmed;
    } catch (e) {
      // Base injoignable : l'appelant recevra son défaut. On ne met PAS
      // l'échec en cache — la panne ne doit pas survivre trente secondes à
      // son propre rétablissement.
      this.logger.warn(`Lecture du paramètre ${key} impossible : ${(e as Error).message}`);
      return null;
    }

    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }
}
