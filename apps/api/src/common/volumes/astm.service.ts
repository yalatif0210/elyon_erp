import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * ===========================================================================
 *  CORRECTION DE VOLUME EN TEMPÉRATURE — ASTM D1250 / API MPMS ch. 11.1
 *  Réf. SPECIFICATIONS.md § 8.2
 *
 *  « Le service ASTM D1250 doit être la SEULE voie de calcul, et l'application
 *    terrain doit OBLIGER à saisir la température à chaque relevé. »
 *
 *  ⚠️ IL N'EXISTAIT PAS. Les volumes « à 15 °C » étaient pris tels quels de la
 *     tablette, sans correction d'aucune sorte.
 *
 *     Un produit se dilate. Un chargement relevé à 32 °C et une livraison
 *     relevée à 26 °C, saisis dans des champs nommés « à 15 °C », produisent
 *     environ 0,48 % d'écart apparent À MASSE CONSTANTE — plus du DOUBLE du
 *     seuil critique d'ullage. Deux conséquences, aussi graves l'une que
 *     l'autre :
 *
 *       · une opération parfaitement saine déclenche une alerte critique, et
 *         l'alerte finit par ne plus être lue ;
 *       · une perte RÉELLE de 0,3 % disparaît si l'écart thermique joue en
 *         sens inverse — et celle-là, personne ne la voit jamais.
 *
 *     Sur 10 000 000 L à 700 FCFA/L, 0,48 % représente 33 600 000 FCFA.
 *
 *  LE CALCUL
 *  ---------
 *  Table 54B (produits pétroliers raffinés), en unités SI :
 *
 *      α₁₅ = K₀ / ρ₁₅²  +  K₁ / ρ₁₅          (coefficient de dilatation à 15 °C)
 *      Δt  = t − 15
 *      VCF = exp( −α₁₅ · Δt · (1 + 0,8 · α₁₅ · Δt) )
 *      V₁₅ = V_observé × VCF
 *
 *  ρ₁₅ est la masse volumique à 15 °C, en kg/m³ — c'est-à-dire la densité du
 *  produit multipliée par 1000.
 *
 *  ⚠️ LES CONSTANTES DÉPENDENT DE LA FAMILLE DE PRODUIT. Les appliquer sans
 *     distinction est faux : le coefficient d'une essence et celui d'un
 *     lubrifiant diffèrent d'un facteur trois. Elles sont donc groupées et
 *     nommées ci-dessous, avec leur domaine de validité.
 *
 *  CE QUE CE SERVICE N'EST PAS
 *  ---------------------------
 *  Ce n'est pas une implémentation certifiée de la norme. La table 54B couvre
 *  aussi des cas particuliers — produits hors plage de masse volumique,
 *  températures extrêmes — pour lesquels la norme prévoit des traitements
 *  spécifiques. Le domaine couvert ici est celui du négoce courant, et
 *  TOUT RELEVÉ QUI EN SORT EST REFUSÉ plutôt qu'approché : un volume faux
 *  accepté en silence vaut moins qu'un relevé refusé avec son motif.
 * ===========================================================================
 */

/** Famille de produit au sens de la table 54B. */
export type FamilleProduit = 'ESSENCES' | 'JET_KEROSENES' | 'GAZOLES' | 'LUBRIFIANTS';

interface ConstantesFamille {
  k0: number;
  k1: number;
  /** Domaine de masse volumique à 15 °C, en kg/m³. Hors de là, la table 54B
   *  ne s'applique pas et le résultat n'aurait aucune valeur. */
  rhoMin: number;
  rhoMax: number;
  libelle: string;
}

/**
 * Constantes de la table 54B, groupées par famille.
 *
 * Ce ne sont PAS des paramètres métier : ce sont des constantes normatives,
 * publiées par l'API et l'ASTM. Les rendre réglables depuis un écran
 * permettrait de fausser tous les volumes de l'entreprise par une saisie.
 * Elles sont nommées et commentées, ce qui est l'exigence réelle.
 */
const TABLE_54B: Record<FamilleProduit, ConstantesFamille> = {
  ESSENCES: {
    k0: 346.4228,
    k1: 0.4388,
    rhoMin: 653,
    rhoMax: 770,
    libelle: 'essences et naphtas',
  },
  JET_KEROSENES: {
    k0: 594.5418,
    k1: 0,
    rhoMin: 770,
    rhoMax: 788,
    libelle: 'carburéacteurs et kérosènes',
  },
  GAZOLES: {
    k0: 186.9696,
    k1: 0.4862,
    rhoMin: 788,
    rhoMax: 1164,
    libelle: 'gazoles et fiouls',
  },
  LUBRIFIANTS: {
    k0: 0,
    k1: 0.6278,
    rhoMin: 801,
    rhoMax: 1164,
    libelle: 'huiles et lubrifiants',
  },
};

/**
 * Plage de température admise, en °C.
 *
 * Au-delà, la table 54B n'est plus applicable et le résultat serait une
 * extrapolation muette. Un relevé à 90 °C n'existe pas dans le négoce
 * routier : c'est une faute de saisie, et la refuser vaut mieux que de la
 * corriger de travers.
 */
const TEMPERATURE_MIN = -18;
const TEMPERATURE_MAX = 90;

export interface VolumeCorrige {
  /** Volume à 15 °C, en unités du volume observé. */
  volume15: number;
  /** Facteur appliqué — CONSERVÉ, sans quoi le calcul n'est pas rejouable. */
  vcf: number;
  famille: FamilleProduit;
}

@Injectable()
export class AstmService {
  /**
   * Famille de produit déduite de la masse volumique à 15 °C.
   *
   * ⚠️ CHOIX ASSUMÉ, À CONNAÎTRE. La table 54B se choisit normalement par la
   *    NATURE du produit, pas par sa masse volumique — et le référentiel des
   *    produits ne porte pas cette nature aujourd'hui. Les plages de masse
   *    volumique des quatre familles étant contiguës et peu recouvrantes dans
   *    le négoce courant, la déduction est fiable pour l'essence (≈ 750), le
   *    kérosène (≈ 780) et le gazole (≈ 840).
   *
   *    Elle ne l'est PAS aux frontières, ni pour les lubrifiants, qui
   *    recouvrent la plage des gazoles. Le jour où le référentiel portera la
   *    famille, elle devra primer sur cette déduction : la signature accepte
   *    déjà une famille explicite.
   */
  familleDepuisMasseVolumique(rho15: number): FamilleProduit {
    if (rho15 < TABLE_54B.ESSENCES.rhoMax) return 'ESSENCES';
    if (rho15 < TABLE_54B.JET_KEROSENES.rhoMax) return 'JET_KEROSENES';
    return 'GAZOLES';
  }

  /**
   * Volume ramené à 15 °C.
   *
   * @param volumeObserve volume relevé, dans l'unité de l'opération
   * @param temperatureC  température au moment du relevé, en °C
   * @param densite15     masse volumique à 15 °C — densité (0,845) ou kg/m³ (845)
   * @param famille       famille explicite ; déduite si absente
   */
  corrige(
    volumeObserve: number,
    temperatureC: number,
    densite15: number,
    famille?: FamilleProduit,
  ): VolumeCorrige {
    if (!Number.isFinite(volumeObserve) || volumeObserve <= 0) {
      throw new BadRequestException('Volume observé absent ou nul : rien à corriger.');
    }
    if (!Number.isFinite(temperatureC)) {
      throw new BadRequestException(
        'Température absente. Sans elle, aucun volume ne peut être ramené à 15 °C, et deux relevés pris à des températures différentes ne sont pas comparables.',
      );
    }
    if (temperatureC < TEMPERATURE_MIN || temperatureC > TEMPERATURE_MAX) {
      throw new BadRequestException(
        `Température de ${temperatureC} °C hors du domaine de correction (${TEMPERATURE_MIN} à ${TEMPERATURE_MAX} °C). Vérifiez le relevé : au-delà, la correction n'a plus de valeur.`,
      );
    }

    // La densité se saisit indifféremment en densité (0,845) ou en kg/m³
    // (845). On ramène à kg/m³ : au-dessous de 10, c'est forcément une densité.
    const rho15 = densite15 < 10 ? densite15 * 1000 : densite15;

    const nom = famille ?? this.familleDepuisMasseVolumique(rho15);
    const c = TABLE_54B[nom];

    if (rho15 < c.rhoMin || rho15 > c.rhoMax) {
      throw new BadRequestException(
        `Masse volumique de ${rho15.toFixed(1)} kg/m³ hors du domaine des ${c.libelle} (${c.rhoMin} à ${c.rhoMax}). La correction en température ne s'applique pas : vérifiez la densité du produit.`,
      );
    }

    const alpha15 = c.k0 / (rho15 * rho15) + c.k1 / rho15;
    const deltaT = temperatureC - 15;
    const vcf = Math.exp(-alpha15 * deltaT * (1 + 0.8 * alpha15 * deltaT));

    return {
      volume15: arrondi(volumeObserve * vcf, 6),
      vcf: arrondi(vcf, 6),
      famille: nom,
    };
  }
}

function arrondi(n: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}
