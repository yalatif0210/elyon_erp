import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Vérifie qu'une référence n'est pas déjà prise. */
export type ReferenceProbe = (reference: string) => Promise<boolean>;

/**
 * Numérotation des pièces (SPECIFICATIONS.md § 12.1).
 *
 * Le compteur est incrémenté PAR LA BASE, dans la même transaction que la
 * lecture. Un compteur tenu en mémoire applicative se dédouble dès qu'un
 * second processus démarre — et la numérotation des factures doit être
 * séquentielle et sans trou pour être opposable.
 *
 * ⚠️ LE COMPTEUR N'EST PAS SEUL AU MONDE. Une reprise de données, un jeu de
 *    démonstration ou une migration peuvent poser des références SANS passer
 *    par lui : le compteur repart alors de 1 et heurte l'existant. Le défaut
 *    ne se voit qu'à la première création réelle, en production, sur l'écran
 *    d'un utilisateur.
 *
 *    D'où la sonde facultative : l'appelant fournit le moyen de savoir si une
 *    référence est déjà prise, et le compteur avance jusqu'à en trouver une
 *    libre. Les numéros ainsi sautés le sont une fois pour toutes — le
 *    compteur reste monotone, ce qui est ce que la loi exige.
 */
@Injectable()
export class ReferenceService {
  /** Garde-fou : au-delà, c'est une anomalie, pas un rattrapage. */
  private static readonly MAX_PROBES = 200;

  constructor(private readonly prisma: PrismaService) {}

  /** Séquence mensuelle : DEAL-2026-08-001. */
  monthly(scope: string, padding = 3, at = new Date(), probe?: ReferenceProbe): Promise<string> {
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth() + 1;
    return this.next(
      scope,
      year,
      month,
      (n) => `${scope}-${year}-${String(month).padStart(2, '0')}-${String(n).padStart(padding, '0')}`,
      probe,
    );
  }

  /** Séquence annuelle : OP-2026-000154. Le mois vaut 0 en base. */
  annual(scope: string, padding = 6, at = new Date(), probe?: ReferenceProbe): Promise<string> {
    const year = at.getUTCFullYear();
    return this.next(
      scope,
      year,
      0,
      (n) => `${scope}-${year}-${String(n).padStart(padding, '0')}`,
      probe,
    );
  }

  private async next(
    scope: string,
    year: number,
    month: number,
    format: (n: number) => string,
    probe?: ReferenceProbe,
  ): Promise<string> {
    for (let attempt = 0; attempt < ReferenceService.MAX_PROBES; attempt += 1) {
      const rows = await this.prisma.$queryRaw<Array<{ last_value: number }>>`
        INSERT INTO number_sequences (id, scope, year, month, last_value, updated_at)
        VALUES (gen_random_uuid(), ${scope}, ${year}, ${month}, 1, now())
        ON CONFLICT (scope, year, month)
        DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
        RETURNING last_value`;

      const reference = format(rows[0].last_value);
      if (!probe || !(await probe(reference))) return reference;
    }

    throw new InternalServerErrorException(
      `Numérotation « ${scope} » : ${ReferenceService.MAX_PROBES} références consécutives déjà prises. Le compteur est désynchronisé — vérifier les reprises de données.`,
    );
  }
}
