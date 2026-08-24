/**
 * GABARIT PDF DU RAPPORT D'EXÉCUTION (§ 10, § 12.2 — clôture terrain).
 *
 * ⚠️ CE DOCUMENT N'EXISTAIT PAS — « DÉCLARÉ, JAMAIS DÉCLENCHÉ ».
 *
 *    `GeneratedDocumentKind.OPERATION_REPORT` figurait dans le schéma, dans
 *    la liste blanche du terrain (`NATURES_VISIBLES_DU_TERRAIN`) et dans les
 *    règles de scellement, mais aucun code ne produisait jamais la pièce.
 *
 *    Le constat de l'agent : chaque étape de la checklist HSE, les incidents
 *    éventuels et les photos prises. Lui seul l'atteste — une seule signature
 *    est exigée à son scellement (`DocumentsService.seal`).
 *
 * Même charpente HTML autonome que `invoice-pdf.template.ts` (CSS inline,
 * aucune ressource externe, rendu par Chromium headless).
 */

export interface OperationReportPhotoData {
  captionOrKind: string;
  dataUri: string;
}

export interface OperationReportCheckItemData {
  label: string;
  level: string;
  outcome: string;
  recordedValue: string | null;
  comment: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
  photos: OperationReportPhotoData[];
}

export interface OperationReportCheckData {
  phase: string;
  validatedAt: string | null;
  validatedByName: string | null;
  items: OperationReportCheckItemData[];
}

export interface OperationReportIncidentData {
  reference: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  occurredAt: string;
  closedAt: string | null;
  closureEvidence: string | null;
  photos: OperationReportPhotoData[];
}

export interface OperationReportPdfData {
  reference: string;
  operationReference: string;
  dealReference: string | null;
  clientLegalName: string;
  productName: string;
  transportMode: string;
  originLocation: string;
  destinationLocation: string;
  plannedVolume: string;
  uom: string;
  actualLoadingDate: string | null;
  actualDischargeDate: string | null;
  fieldAgentName: string | null;
  checks: OperationReportCheckData[];
  incidents: OperationReportIncidentData[];
  verifyUrl: string;
  qrDataUri: string;
}

const PHASE_LABEL: Record<string, string> = {
  PREPARATION: 'Préparation',
  PRE_CHARGEMENT: 'Avant chargement',
  CHARGEMENT: 'Chargement',
  POST_CHARGEMENT: 'Après chargement',
  TRANSPORT: 'Transport',
  PRE_DECHARGEMENT: 'Avant déchargement',
  DECHARGEMENT: 'Déchargement',
  POST_DECHARGEMENT: 'Après déchargement',
  CLOTURE: 'Clôture',
};

const OUTCOME_LABEL: Record<string, string> = {
  PENDING: 'En attente',
  PASSED: 'Conforme',
  FAILED: 'Non conforme',
  NOT_APPLICABLE: 'Non applicable',
};

const LEVEL_LABEL: Record<string, string> = {
  RECOMMENDED: 'Recommandé',
  MANDATORY: 'Obligatoire',
  CONDITIONAL: 'Conditionnel',
  BLOCKING: 'Bloquant',
};

const SEVERITY_LABEL: Record<string, string> = {
  MINOR: 'Mineure',
  MODERATE: 'Modérée',
  MAJOR: 'Majeure',
  CRITICAL: 'Critique',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  INCIDENT: 'Incident',
  ACCIDENT: 'Accident',
  SPILL: 'Déversement',
  NEAR_MISS: 'Quasi-accident',
  DANGEROUS_OBSERVATION: 'Observation dangereuse',
  NON_CONFORMITY: 'Non-conformité',
};

const EVENT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Ouvert',
  UNDER_INVESTIGATION: 'En investigation',
  ACTION_IN_PROGRESS: 'Action en cours',
  CLOSED: 'Clos',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const OUTCOME_CLASS: Record<string, string> = {
  PASSED: 'ok',
  FAILED: 'crit',
  NOT_APPLICABLE: 'muted',
  PENDING: 'warn',
};

function renderPhotos(photos: OperationReportPhotoData[]): string {
  if (photos.length === 0) return '';
  return `<div class="photos">${photos
    .map((p) => `<figure><img src="${p.dataUri}"><figcaption>${esc(p.captionOrKind)}</figcaption></figure>`)
    .join('')}</div>`;
}

function renderCheck(c: OperationReportCheckData): string {
  return `
  <div class="phase">
    <div class="phase-head">
      <span class="phase-name">${PHASE_LABEL[c.phase] ?? esc(c.phase)}</span>
      <span class="phase-valid">${c.validatedAt ? `Validée le ${fmtDate(c.validatedAt)}${c.validatedByName ? ' par ' + esc(c.validatedByName) : ''}` : 'Non validée'}</span>
    </div>
    <table class="items">
      <thead>
        <tr><th>Point de contrôle</th><th>Niveau</th><th>Résultat</th><th>Relevé</th></tr>
      </thead>
      <tbody>
        ${c.items
          .map(
            (i) => `
        <tr>
          <td>
            ${esc(i.label)}
            ${i.comment ? `<div class="comment">${esc(i.comment)}</div>` : ''}
            ${renderPhotos(i.photos)}
          </td>
          <td>${LEVEL_LABEL[i.level] ?? esc(i.level)}</td>
          <td><span class="badge ${OUTCOME_CLASS[i.outcome] ?? ''}">${OUTCOME_LABEL[i.outcome] ?? esc(i.outcome)}</span></td>
          <td>${i.recordedValue ? esc(i.recordedValue) : '-'}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function renderIncident(e: OperationReportIncidentData): string {
  return `
  <div class="incident">
    <div class="incident-head">
      <span class="incident-ref">${esc(e.reference)}</span>
      <span class="badge ${e.severity === 'CRITICAL' || e.severity === 'MAJOR' ? 'crit' : 'warn'}">${SEVERITY_LABEL[e.severity] ?? esc(e.severity)}</span>
      <span class="incident-type">${EVENT_TYPE_LABEL[e.type] ?? esc(e.type)}</span>
      <span class="incident-status">${EVENT_STATUS_LABEL[e.status] ?? esc(e.status)}</span>
    </div>
    <div class="incident-title">${esc(e.title)}</div>
    <p class="incident-desc">${esc(e.description)}</p>
    <div class="incident-meta">Survenu le ${fmtDateTime(e.occurredAt)}${e.closedAt ? ` · Clos le ${fmtDateTime(e.closedAt)}` : ''}</div>
    ${e.closureEvidence ? `<div class="comment">Preuve de clôture : ${esc(e.closureEvidence)}</div>` : ''}
    ${renderPhotos(e.photos)}
  </div>`;
}

export function renderOperationReportHtml(d: OperationReportPdfData): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 10.5px;
    color: #17222E;
    line-height: 1.5;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #17222E;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .brand-sub { font-size: 10px; color: #4C5A6B; margin-top: 2px; }
  .doctype { text-align: right; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
  .docnum { font-family: "Courier New", monospace; font-size: 15px; margin-top: 4px; }
  .meta { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-bottom: 20px; }
  .meta .block { flex: 1 1 30%; min-width: 140px; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #7A8898; margin-bottom: 3px; }
  .value { font-size: 12px; font-weight: 600; }
  h2.section {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
    margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #D3DAE2;
  }
  .phase { margin-bottom: 16px; page-break-inside: avoid; }
  .phase-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .phase-name { font-size: 12px; font-weight: 700; }
  .phase-valid { font-size: 10px; color: #4C5A6B; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.items th {
    text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #7A8898; border-bottom: 1px solid #D3DAE2; padding: 5px 6px;
  }
  table.items td { padding: 7px 6px; border-bottom: 1px solid #EEF1F5; font-size: 10.5px; vertical-align: top; }
  .badge {
    display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 9.5px; font-weight: 600;
    background: #EEF1F5; color: #4C5A6B;
  }
  .badge.ok { background: #E3F3E9; color: #1F7A44; }
  .badge.crit { background: #FBE4E1; color: #9C2C1F; }
  .badge.warn { background: #F5EAD2; color: #6B4A0C; }
  .badge.muted { background: #EEF1F5; color: #7A8898; }
  .comment { font-size: 10px; color: #4C5A6B; margin-top: 4px; font-style: italic; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .photos figure { margin: 0; width: 90px; }
  .photos img { width: 90px; height: 68px; object-fit: cover; border-radius: 3px; border: 1px solid #D3DAE2; }
  .photos figcaption { font-size: 8px; color: #7A8898; margin-top: 2px; word-break: break-word; }
  .incident { border: 1px solid #D3DAE2; border-radius: 4px; padding: 10px 12px; margin-bottom: 10px; page-break-inside: avoid; }
  .incident-head { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
  .incident-ref { font-family: "Courier New", monospace; font-size: 10.5px; font-weight: 700; }
  .incident-type, .incident-status { font-size: 10px; color: #4C5A6B; }
  .incident-title { font-size: 11.5px; font-weight: 700; margin-bottom: 3px; }
  .incident-desc { margin: 0 0 4px; font-size: 10.5px; }
  .incident-meta { font-size: 9.5px; color: #7A8898; }
  .empty { font-size: 10.5px; color: #7A8898; font-style: italic; }
  .signoff {
    margin-top: 30px; padding-top: 14px; border-top: 1px solid #D3DAE2;
    display: flex; justify-content: space-between; gap: 24px;
  }
  .signoff .who { flex: 1; }
  .signoff .who .line { margin-top: 34px; border-top: 1px solid #17222E; padding-top: 4px; font-size: 10px; }
  .footer {
    margin-top: 24px; padding-top: 14px; border-top: 1px solid #D3DAE2;
    display: flex; justify-content: space-between; align-items: flex-end;
  }
  .footer .legal { font-size: 9px; color: #7A8898; max-width: 400px; line-height: 1.6; }
  .footer .qr { text-align: center; }
  .footer .qr img { width: 70px; height: 70px; }
</style>
</head>
<body>

  <div class="head">
    <div>
      <div class="brand">ELYON TRADING</div>
      <div class="brand-sub">Négoce, distribution et transport d'hydrocarbures · Côte d'Ivoire</div>
    </div>
    <div class="doctype">
      RAPPORT D'EXÉCUTION D'OPÉRATION
      <div class="docnum">${esc(d.reference)}</div>
    </div>
  </div>

  <div class="meta">
    <div class="block">
      <div class="label">Opération</div>
      <div class="value">${esc(d.operationReference)}</div>
    </div>
    <div class="block">
      <div class="label">Affaire</div>
      <div class="value">${d.dealReference ? esc(d.dealReference) : '-'}</div>
    </div>
    <div class="block">
      <div class="label">Client</div>
      <div class="value">${esc(d.clientLegalName)}</div>
    </div>
    <div class="block">
      <div class="label">Produit</div>
      <div class="value">${esc(d.productName)}</div>
    </div>
    <div class="block">
      <div class="label">Trajet</div>
      <div class="value">${esc(d.originLocation)} → ${esc(d.destinationLocation)}</div>
    </div>
    <div class="block">
      <div class="label">Volume prévu</div>
      <div class="value">${Number(d.plannedVolume).toLocaleString('fr-FR')} ${esc(d.uom)}</div>
    </div>
    <div class="block">
      <div class="label">Chargement / Livraison</div>
      <div class="value">${fmtDate(d.actualLoadingDate)} → ${fmtDate(d.actualDischargeDate)}</div>
    </div>
    <div class="block">
      <div class="label">Agent terrain</div>
      <div class="value">${d.fieldAgentName ? esc(d.fieldAgentName) : '-'}</div>
    </div>
  </div>

  <h2 class="section">Contrôles HSE</h2>
  ${d.checks.length > 0 ? d.checks.map(renderCheck).join('') : '<p class="empty">Aucun contrôle HSE enregistré pour cette opération.</p>'}

  <h2 class="section">Incidents et événements HSE</h2>
  ${d.incidents.length > 0 ? d.incidents.map(renderIncident).join('') : '<p class="empty">Aucun incident déclaré au cours de cette opération.</p>'}

  <div class="signoff">
    <div class="who">
      <div class="line">Agent terrain : ${d.fieldAgentName ? esc(d.fieldAgentName) : ''}</div>
    </div>
  </div>

  <div class="footer">
    <div class="legal">
      Rapport constaté et attesté par l'agent terrain seul. Scellé et horodaté par le
      système dès sa signature ; toute correction ultérieure fait l'objet d'un document distinct
      portant la mention « annule et remplace ». L'authenticité de cet exemplaire est vérifiable
      en scannant le QR code ci-contre.
    </div>
    <div class="qr">
      <img src="${d.qrDataUri}" alt="QR d'authenticité">
    </div>
  </div>

</body>
</html>`;
}
