import { Controller, Get } from '@nestjs/common';
import { FieldRole, HseEventType, HseSeverity, MeasurementSource } from '@prisma/client';
import { FieldRoles, Realm, RequireRealm } from '../common/auth/realm';

/**
 * VOCABULAIRE TERRAIN — les valeurs fixes que la tablette n'a plus à deviner.
 *
 * ⚠️ CORRIGÉ (§ 25/08/2026) — `FieldVocabularyService` (web) n'avait, pour
 *    certains champs, AUCUN moyen de connaître les valeurs admises avant une
 *    première saisie refusée : « source », « nature » et « gravité » d'un
 *    incident ne s'observent nulle part ailleurs dans les objets lus par la
 *    tablette (contrairement à `phase`, apprise sur chaque checklist déjà
 *    ouverte). Le premier agent à ouvrir l'écran de relevé ou d'incident
 *    tapait donc à l'aveugle, condamné à un refus pour connaître la liste —
 *    un journal qui grossit pour rien, et un geste perdu sur le terrain,
 *    parfois sans réseau pour ressaisir tout de suite.
 *
 *    Ces trois valeurs ne sont PAS du paramétrage métier : ce sont des
 *    énumérations Prisma, closes, qui ne changent qu'avec un déploiement de
 *    code — les publier ici ne crée donc PAS une seconde vérité à tenir à
 *    jour, au sens où `field-vocabulary.service.ts` (web) met en garde contre
 *    le RECOPIAGE de valeurs qui, elles, évoluent côté serveur sans lui.
 *
 *    `/api/internal/parameters` reste fermé au jeton de la tablette pour le
 *    paramétrage RÉELLEMENT administrable (seuils, modèles HSE…) : cette
 *    route-ci n'en fait pas partie, elle ne fait que réciter des `enum`.
 */
@Controller('api/field/vocabulaire')
@RequireRealm(Realm.FIELD)
@FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
export class FieldVocabularyController {
  @Get()
  lire(): { source: string[]; hseEventType: string[]; severity: string[] } {
    return {
      source: Object.values(MeasurementSource),
      hseEventType: Object.values(HseEventType),
      severity: Object.values(HseSeverity),
    };
  }
}
