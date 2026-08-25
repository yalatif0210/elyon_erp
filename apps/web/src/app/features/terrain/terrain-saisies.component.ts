import { Component, Directive, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FieldApiService, FieldOperationDetail } from '../../core/field-api.service';
import { FieldEventType, FieldQueueService } from '../../core/field-queue.service';
import {
  TerrainCompteRenduComponent,
  TerrainRetourComponent,
} from './terrain-cadre.component';
import { deposer, messageServeur } from './terrain-depot';
import { maintenantLocal, versIso } from './terrain-libelles';
import { VocabulaireChoixComponent } from './vocabulaire-choix.component';
import { MontantDirective } from '../../shared/montant.directive';

/**
 * Socle commun aux écrans de saisie du terrain.
 *
 * Trois écrans, un seul comportement : charger le dossier pour connaître le
 * contexte, produire UN événement, rendre compte de son sort. Le mutualiser
 * évite surtout que le traitement des trois sorts diverge d'un écran à
 * l'autre — c'est précisément là que du travail se perdrait.
 *
 * `@Directive()` sans sélecteur : une classe de base qui porte une entrée et
 * un crochet de cycle de vie doit être décorée, faute de quoi le compilateur
 * la refuse (NG2007).
 */
@Directive()
abstract class EcranDeSaisie implements OnInit {
  protected readonly api = inject(FieldApiService);
  protected readonly file = inject(FieldQueueService);

  @Input() id = '';

  protected readonly operation = signal<FieldOperationDetail | null>(null);
  protected readonly occupe = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  ngOnInit(): void {
    this.api.operation(this.id).subscribe({
      next: (d) => {
        this.operation.set(d);
        this.apresChargement(d);
      },
      error: (e: unknown) => this.erreur.set(messageServeur(e, 'Opération inaccessible.')),
    });
  }

  /** Pré-remplissage à partir du dossier — jamais à partir d'une valeur figée. */
  protected apresChargement(_detail: FieldOperationDetail): void {
    // Rien par défaut.
  }

  /** Met l'événement en file et rend `true` si l'effet est acquis en base. */
  protected async envoyer(
    type: FieldEventType,
    intitule: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    this.occupe.set(true);
    this.erreur.set(null);
    this.info.set(null);

    const compte = await deposer(this.file, {
      operationId: this.id,
      reference: this.operation()?.reference ?? this.id,
      type,
      intitule,
      payload,
    });

    this.occupe.set(false);
    this.info.set(compte.info);
    this.erreur.set(compte.erreur);
    return compte.acquis;
  }
}

// ===========================================================================
//  RELEVÉ DE VOLUME
// ===========================================================================

/**
 * `MEASUREMENT_RECORDED` — charge utile validée contre `MeasurementDto`.
 *
 * Tous les champs obligatoires du DTO sont exigés à l'écran : un relevé
 * incomplet serait refusé par le serveur, et un refus brûle l'identifiant de
 * l'événement. Mieux vaut retenir la saisie ici que la faire refaire là-bas.
 *
 * La TEMPÉRATURE est facultative pour le DTO mais exigée par l'écran : le
 * § 10.4 la rend obligatoire à la saisie, et un volume ramené à 15 °C sans
 * température observée n'est pas vérifiable. C'est une exigence d'interface,
 * assumée comme telle — le serveur reste seul juge de ce qu'il accepte.
 */
@Component({
  selector: 'terrain-releve',
  standalone: true,
  imports: [
    FormsModule,
    TerrainRetourComponent,
    TerrainCompteRenduComponent,
    VocabulaireChoixComponent,
    MontantDirective,
  ],
  template: `
    <div class="t-screen">
      <terrain-retour [operationId]="id" />
      <terrain-compte-rendu [erreur]="erreur()" [info]="info()" />

      <h1 class="t-title mt-2">Relever un volume</h1>
      <p class="t-sub">
        Le volume est ramené à 15 °C par le serveur. L'écart avec l'autre bout (chargement ou
        livraison) se calcule dès qu'il existe : rien n'oblige à connaître les deux à la fois.
      </p>

      <!-- ⚠️ CORRIGÉ (§ 25/08/2026) — un relevé ne porte plus qu'un seul
           bout. Le chargement et la livraison se constatent rarement au
           même moment, parfois pas par le même agent : imposer les deux
           d'un coup empêchait de saisir ce qu'on avait sous la main. -->
      <div class="mt-5">
        <label class="t-label" for="mphase">Étape du relevé</label>
        <select id="mphase" class="t-field" [(ngModel)]="phase">
          @for (p of operation()?.phaseSequence ?? []; track p) {
            <option [value]="p">{{ p }}</option>
          }
        </select>
      </div>

      <div class="mt-5">
        <terrain-choix champ="source" libelle="Source du relevé" idChamp="source" [(value)]="source" />
      </div>

      <div class="mt-4">
        <label class="t-label" for="quand">Date et heure du relevé</label>
        <input id="quand" type="datetime-local" class="t-field" [(ngModel)]="quand" />
      </div>

      <!-- ⚠️ ON RELÈVE CE QU'ON VOIT À LA JAUGE, PAS UN VOLUME « À 15 °C ».
           Les anciens champs demandaient un volume déjà corrigé — que
           personne ne corrigeait. La dilatation du produit se comptait donc
           comme une perte, plus du double du seuil critique sur une
           opération parfaitement saine. Le serveur applique la correction
           ASTM D1250 (§ 8.2) ; il lui faut la température. -->
      <div class="mt-2">
        <label class="t-label" for="ovolume">Volume relevé à la jauge</label>
        <input
          id="ovolume"
          class="t-field tabular"
          erpMontant
          [(ngModel)]="observedVolume"
        />
      </div>
      <div class="mt-3">
        <label class="t-label" for="otemp">Température (°C)</label>
        <input
          id="otemp"
          type="number"
          inputmode="decimal"
          step="0.1"
          class="t-field tabular"
          [(ngModel)]="tempC"
        />
        <p class="t-hint">
          Sans elle, le volume ne peut pas être ramené à 15 °C, et deux relevés pris à des
          températures différentes ne sont pas comparables.
        </p>
      </div>

      <div class="mt-4">
        <terrain-choix champ="uom" libelle="Unité" idChamp="uom" [(value)]="uom" />
        <p class="t-hint">Pré-remplie avec l’unité de l’opération.</p>
      </div>

      <div class="mt-4">
        <label class="t-label" for="densite">Densité mesurée à 15 °C</label>
        <input
          id="densite"
          type="number"
          inputmode="decimal"
          step="0.0001"
          class="t-field tabular"
          [(ngModel)]="measuredDensity15"
        />
        @if (operation(); as op) {
          <p class="t-hint">Densité de référence du produit : {{ op.product.referenceDensity15 }}</p>
        }
      </div>

      <div class="mt-4">
        <label class="flex items-center gap-2.5 text-[16px] text-ink">
          <input type="checkbox" class="h-6 w-6 accent-[var(--primary)]" [(ngModel)]="isOffSpec" />
          Produit hors spécification
        </label>
      </div>

      <terrain-compte-rendu [erreur]="erreur()" [info]="info()" />

      <div class="t-actionbar">
        <button class="t-btn-primary" [disabled]="occupe() || !complet()" (click)="soumettre()">
          {{ occupe() ? 'Envoi…' : 'Enregistrer le relevé' }}
        </button>
      </div>
    </div>
  `,
})
export class TerrainMeasurementComponent extends EcranDeSaisie {
  protected phase = '';
  protected source = '';
  protected quand = maintenantLocal();
  protected uom = '';
  protected measuredDensity15: number | null = null;
  protected isOffSpec = false;

  protected observedVolume: number | null = null;
  protected tempC: number | null = null;

  protected override apresChargement(d: FieldOperationDetail): void {
    // L'unité vient de l'opération : la faire ressaisir invite à la faute, et
    // un litre pris pour un mètre cube fausse tout ce qui suit.
    this.uom = d.uom;
    // Pré-rempli sur l'étape courante, mais modifiable : un relevé tardif
    // sur une étape déjà quittée reste un geste légitime.
    this.phase = d.phase;
  }

  protected complet(): boolean {
    return (
      this.phase !== '' &&
      this.source !== '' &&
      this.quand !== '' &&
      this.uom !== '' &&
      estPositif(this.observedVolume) &&
      this.measuredDensity15 !== null &&
      this.tempC !== null
    );
  }

  protected async soumettre(): Promise<void> {
    const acquis = await this.envoyer(
      'MEASUREMENT_RECORDED',
      `Relevé ${this.phase} · ${this.observedVolume} ${this.uom}`,
      {
        phase: this.phase,
        source: this.source,
        measurementDate: versIso(this.quand),
        observedVolume: Number(this.observedVolume),
        tempC: Number(this.tempC),
        uom: this.uom,
        measuredDensity15: Number(this.measuredDensity15),
        ...(this.isOffSpec ? { isOffSpec: true } : {}),
        // `isAuthoritative` n'est pas transmis : désigner le relevé faisant
        // autorité est une décision de recette, pas un geste de terrain.
      },
    );
    if (acquis) this.reinitialiser();
  }

  private reinitialiser(): void {
    this.observedVolume = null;
    this.tempC = null;
    this.measuredDensity15 = null;
    this.isOffSpec = false;
  }
}

/**
 * `HSE_EVENT_DECLARED` — charge utile validée contre `HseEventDto`.
 *
 * L'opération n'est PAS transmise dans la charge : le serveur la prend de
 * l'enveloppe de l'événement. Un appareil qui y glisserait un autre
 * identifiant rattacherait son incident au dossier d'un autre client.
 */
@Component({
  selector: 'terrain-incident',
  standalone: true,
  imports: [
    FormsModule,
    TerrainRetourComponent,
    TerrainCompteRenduComponent,
    VocabulaireChoixComponent,
    MontantDirective,
  ],
  template: `
    <div class="t-screen">
      <terrain-retour [operationId]="id" />
      <h1 class="t-title mt-2">Déclarer un incident</h1>
      <p class="t-sub">
        Un quasi-accident se déclare comme un accident : c'est ce qui n'a pas eu de conséquence
        cette fois-ci qui dit où elle arrivera.
      </p>

      <div class="mt-5">
        <terrain-choix champ="hseEventType" libelle="Nature" idChamp="nature" [(value)]="type" />
      </div>

      <div class="mt-4">
        <terrain-choix champ="severity" libelle="Gravité" idChamp="gravite" [(value)]="severity" />
      </div>

      <div class="mt-4">
        <label class="t-label" for="quand-i">Survenu le</label>
        <input id="quand-i" type="datetime-local" class="t-field" [(ngModel)]="quand" />
      </div>

      <div class="mt-4">
        <label class="t-label" for="titre">Intitulé</label>
        <input id="titre" class="t-field" maxlength="200" [(ngModel)]="title" />
      </div>

      <div class="mt-4">
        <label class="t-label" for="lieu">Lieu (facultatif)</label>
        <input id="lieu" class="t-field" maxlength="200" [(ngModel)]="location" />
      </div>

      <div class="mt-4">
        <label class="t-label" for="desc">Description</label>
        <textarea id="desc" class="t-field" maxlength="4000" [(ngModel)]="description"></textarea>
        <p class="t-hint">
          Dix caractères au minimum. Décrivez ce que vous avez constaté, pas ce que vous en
          déduisez, la qualification se fait ensuite, sur pièces.
        </p>
      </div>

      <div class="t-actionbar">
        <button class="t-btn-primary" [disabled]="occupe() || !complet()" (click)="soumettre()">
          {{ occupe() ? 'Envoi…' : 'Déclarer' }}
        </button>
      </div>
    </div>
  `,
})
export class TerrainIncidentComponent extends EcranDeSaisie {
  protected type = '';
  protected severity = '';
  protected quand = maintenantLocal();
  protected title = '';
  protected location = '';
  protected description = '';

  protected complet(): boolean {
    return (
      this.type !== '' &&
      this.severity !== '' &&
      this.quand !== '' &&
      this.title.trim() !== '' &&
      this.description.trim().length >= 10
    );
  }

  protected async soumettre(): Promise<void> {
    const acquis = await this.envoyer('HSE_EVENT_DECLARED', `Incident : ${this.title}`, {
      type: this.type,
      severity: this.severity,
      title: this.title.trim(),
      description: this.description.trim(),
      occurredAt: versIso(this.quand),
      ...(this.location.trim() ? { location: this.location.trim() } : {}),
    });
    if (acquis) {
      this.title = '';
      this.location = '';
      this.description = '';
      this.quand = maintenantLocal();
    }
  }
}

// ===========================================================================
//  AVANCEMENT DE L'OPÉRATION
// ===========================================================================

/**
 * `STATUS_ADVANCED` — charge utile validée contre `TransitionDto`.
 *
 * L'écran ne connaît AUCUN enchaînement d'états : il n'énumère pas les
 * transitions permises et n'en interdit aucune. C'est la base qui les tient,
 * avec les verrous qui vont avec — pas de chargement sans contrôles HSE
 * validés, notamment. Rejouer ces règles ici en donnerait une seconde version,
 * qui divergerait au premier ajustement.
 *
 * ⚠️ CORRIGÉ (§ 25/08/2026) — l'agent choisissait auparavant « le » nouvel
 *    état dans une liste ouverte à toutes les valeurs apprises. Or la
 *    séquence est désormais STRICTE : il n'existe qu'UNE étape suivante
 *    possible, et le serveur la connaît déjà (`nextPhase`, calculée par
 *    `FieldOperationsService.findOne()` dans le même ordre que le trigger
 *    `enforce_phase_sequence`). Faire choisir l'agent entre des valeurs qui
 *    seraient de toute façon refusées n'aidait personne : il n'a plus qu'à
 *    constater l'étape suivante et l'exécuter, avec un motif s'il le juge
 *    utile.
 */
@Component({
  selector: 'terrain-avancement',
  standalone: true,
  imports: [FormsModule, TerrainRetourComponent, TerrainCompteRenduComponent, MontantDirective],
  template: `
    <div class="t-screen">
      <terrain-retour [operationId]="id" />
      <terrain-compte-rendu [erreur]="erreur()" [info]="info()" />

      <h1 class="t-title mt-2">Faire avancer l’opération</h1>
      @if (operation(); as op) {
        <p class="t-sub">
          État actuel : <span class="t-code text-[15px]">{{ op.phase }}</span>
        </p>

        @if (op.haltedAt) {
          <p class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash p-4 text-[15px] leading-relaxed text-crit">
            Opération à l’arrêt ({{ op.haltType }}){{ op.haltReason ? ' : ' + op.haltReason : '' }}.
            Elle n’avance plus.
          </p>
        } @else if (!op.nextPhase) {
          <p class="mt-3 rounded-[3px] border border-rule-strong bg-gray-50 p-4 text-[15px] leading-relaxed text-ink-soft">
            L’opération est déjà à sa dernière étape.
          </p>
        } @else {
          @if (bloquants(op) > 0) {
            <p
              class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash p-4 text-[15px]
                     leading-relaxed text-crit"
            >
              {{ bloquants(op) }} point(s) de contrôle bloquant(s) ne sont pas levés. Le verrou HSE
              est tenu automatiquement : tant qu’ils restent en souffrance, l’avancement sera refusé.
            </p>
          }

          <!-- ⚠️ (§ 25/08/2026) — cette étape a produit un refus définitif en
               test réel : le bouton restait actif alors que la checklist de
               L'ÉTAPE COURANTE (celle qu'on QUITTE) n'avait même pas encore
               été ouverte. currentPhaseRequiresCheck vient du serveur — le
               client ne peut pas savoir seul si une étape en exige une. -->
          @if (checklistCouranteManquante(op)) {
            <p
              class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash p-4 text-[15px]
                     leading-relaxed text-crit"
            >
              La checklist de l’étape en cours ({{ op.phase }}) n’est pas validée. Ouvrez-la et
              validez-la depuis le dossier de l’opération avant de faire avancer : sans elle, le
              verrou HSE refusera l’avancement.
            </p>
          }

          <!-- ⚠️ (§ 25/08/2026) — même refus définitif constaté en test réel,
               pour la CLÔTURE cette fois : sans ambiguïté possible (contrairement
               à currentPhaseRequiresCheck), TOUTE opération qui clôture exige les
               deux pièces scellées, quel que soit son type. -->
          @if (op.nextPhase === 'CLOTURE' && clotureIncomplete(op)) {
            <p
              class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash p-4 text-[15px]
                     leading-relaxed text-crit"
            >
              Le rapport d’exécution et le bon de livraison doivent être générés et signés avant
              la clôture. Rendez-vous sur l’écran de clôture pour les produire et les faire signer :
              sans eux, le verrou refusera l’avancement.
            </p>
          }

          <p class="mt-5 t-sub">
            Étape suivante : <span class="t-code text-[15px]">{{ op.nextPhase }}</span>
          </p>

          <div class="mt-4">
            <label class="t-label" for="motif">Commentaire (facultatif)</label>
            <textarea id="motif" class="t-field" maxlength="1000" [(ngModel)]="reason"></textarea>
          </div>

          <div class="t-actionbar">
            <button
              class="t-btn-primary"
              [disabled]="
                occupe() ||
                checklistCouranteManquante(op) ||
                (op.nextPhase === 'CLOTURE' && clotureIncomplete(op))
              "
              (click)="soumettre(op.nextPhase)"
            >
              {{ occupe() ? 'Envoi…' : 'Faire avancer' }}
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class TerrainStatusComponent extends EcranDeSaisie {
  protected reason = '';

  protected bloquants(d: FieldOperationDetail): number {
    return d.hse.checks.reduce((total, c) => total + c.blockingPending, 0);
  }

  /** L'étape qu'on quitte exige une checklist, et elle n'est pas validée. */
  protected checklistCouranteManquante(d: FieldOperationDetail): boolean {
    return d.hse.currentPhaseRequiresCheck && !d.hse.validatedAt;
  }

  /** Le rapport d'exécution et le bon de livraison, scellés tous les deux — sans ambiguïté, exigé pour TOUTE clôture. */
  protected clotureIncomplete(d: FieldOperationDetail): boolean {
    const scelle = (kind: string) => d.documents.some((doc) => doc.kind === kind && doc.isSealed);
    return !scelle('OPERATION_REPORT') || !scelle('DELIVERY_NOTE');
  }

  protected async soumettre(to: string): Promise<void> {
    const acquis = await this.envoyer('STATUS_ADVANCED', `Avancement vers ${to}`, {
      to,
      ...(this.reason.trim() ? { reason: this.reason.trim() } : {}),
    });
    if (acquis) {
      this.reason = '';
    }
  }
}

/** Le serveur exige des volumes strictement positifs : on le vérifie avant. */
function estPositif(valeur: number | null): boolean {
  return valeur !== null && Number(valeur) > 0;
}
