import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * COURS DE CHANGE — POINT UNIQUE DE LECTURE.
 *
 * Le pivot (USD) sert à additionner des engagements pris dans des devises
 * différentes : c'est un instrument de calcul interne, jamais une devise que
 * quiconque possède ou lit couramment. Tout agrégat qui en résulte doit être
 * reconverti dans la devise locale d'affichage avant d'atteindre un écran ou
 * un document : personne ne doit jamais voir un montant « en pivot ».
 */
@Injectable()
export class FxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cours du jour entre deux devises. Le sens inverse est accepté et inversé :
   * une paire USD/XOF sert les deux conversions.
   */
  async rate(from: string, to: string): Promise<number> {
    if (from === to) return 1;
    const today = new Date();
    const window = {
      effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
    };

    const direct = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: from, quoteCurrencyCode: to, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (direct) return Number(direct.rate);

    const inverse = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: to, quoteCurrencyCode: from, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (inverse) return 1 / Number(inverse.rate);

    throw new BadRequestException(`Aucun cours de change en vigueur pour ${from} vers ${to}.`);
  }

  /** Devise pivot du référentiel — instrument de calcul, jamais montrée telle quelle. */
  async pivotCode(): Promise<string> {
    const pivot = await this.prisma.currency.findFirstOrThrow({ where: { isPivot: true } });
    return pivot.code;
  }

  /** Devise locale — celle dans laquelle tout agrégat se restitue à l'écran et au document. */
  async localCode(): Promise<string> {
    const local = await this.prisma.currency.findFirstOrThrow({ where: { isLocal: true } });
    return local.code;
  }

  /** Cours courant du pivot vers la devise locale d'affichage. */
  async pivotToLocalRate(): Promise<number> {
    const [pivot, local] = await Promise.all([this.pivotCode(), this.localCode()]);
    return this.rate(pivot, local);
  }
}
