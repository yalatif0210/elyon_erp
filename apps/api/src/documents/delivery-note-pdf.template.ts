/**
 * GABARIT PDF DU BON DE LIVRAISON (§ 10, § 12.2 — clôture terrain).
 *
 * ⚠️ CE DOCUMENT N'EXISTAIT PAS — MÊME CONSTAT QUE LE RAPPORT D'EXÉCUTION.
 *
 *    `GeneratedDocumentKind.DELIVERY_NOTE` était déclaré partout où la
 *    signature terrain est modélisée, mais rien ne le produisait. Contrairement
 *    au rapport, il ENGAGE LES DEUX PARTIES : son scellement exige la
 *    signature de l'agent ET du représentant du client
 *    (`DocumentsService.seal`) — c'est la pièce que le client emporte.
 *
 * Même charpente HTML autonome que `invoice-pdf.template.ts`.
 */

export interface DeliveryNotePdfData {
  reference: string;
  operationReference: string;
  dealReference: string | null;
  clientLegalName: string;
  clientTaxpayerAccountNumber: string | null;
  productName: string;
  transportMode: string;
  originLocation: string;
  destinationLocation: string;
  plannedVolume: string;
  uom: string;
  /** Volume effectivement livré, si un relevé fait foi ; sinon le prévu. */
  deliveredVolume: string;
  isDeliveredVolumeAuthoritative: boolean;
  actualLoadingDate: string | null;
  actualDischargeDate: string | null;
  fieldAgentName: string | null;
  carrierName: string | null;
  vehicleRegistration: string | null;
  vehicleIdentifier: string | null;
  driverName: string | null;
  verifyUrl: string;
  qrDataUri: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TRANSPORT_LABEL: Record<string, string> = {
  PIPELINE: 'Pipeline',
  BUNKERING: 'Soutage maritime',
  BARGE: 'Barge',
  TRUCK: 'Camion',
  RAIL: 'Rail',
};

export function renderDeliveryNoteHtml(d: DeliveryNotePdfData): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 11px;
    color: #17222E;
    line-height: 1.5;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #17222E;
    padding-bottom: 14px;
    margin-bottom: 20px;
  }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .brand-sub { font-size: 10px; color: #4C5A6B; margin-top: 2px; }
  .doctype { text-align: right; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
  .docnum { font-family: "Courier New", monospace; font-size: 15px; margin-top: 4px; }
  .banner {
    background: #F5EAD2; border: 1px solid #9A6B12; color: #6B4A0C;
    padding: 8px 12px; font-weight: 700; text-align: center; margin-bottom: 16px; font-size: 11px;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 20px 24px; margin-bottom: 20px; }
  .meta .block { flex: 1 1 28%; min-width: 150px; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #7A8898; margin-bottom: 3px; }
  .value { font-size: 12px; font-weight: 600; }
  h2.section {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
    margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #D3DAE2;
  }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.lines th {
    text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #7A8898; border-bottom: 1px solid #D3DAE2; padding: 6px 8px;
  }
  table.lines td { padding: 10px 8px; border-bottom: 1px solid #EEF1F5; font-size: 11.5px; }
  table.lines .num { text-align: right; font-variant-numeric: tabular-nums; }
  .transport-grid { display: flex; flex-wrap: wrap; gap: 16px 24px; }
  .transport-grid .block { flex: 1 1 28%; min-width: 150px; }
  .signoff {
    margin-top: 40px; padding-top: 14px; border-top: 1px solid #D3DAE2;
    display: flex; justify-content: space-between; gap: 32px;
  }
  .signoff .who { flex: 1; }
  .signoff .who .cap { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #7A8898; margin-bottom: 30px; }
  .signoff .who .line { border-top: 1px solid #17222E; padding-top: 4px; font-size: 10px; }
  .footer {
    margin-top: 24px; padding-top: 14px; border-top: 1px solid #D3DAE2;
    display: flex; justify-content: space-between; align-items: flex-end;
  }
  .footer .legal { font-size: 9px; color: #7A8898; max-width: 400px; line-height: 1.6; }
  .footer .qr { text-align: center; }
  .footer .qr img { width: 70px; height: 70px; }
  .footer .qr .cap { font-size: 8px; color: #7A8898; margin-top: 4px; }
</style>
</head>
<body>

  <div class="head">
    <div>
      <div class="brand">ELYON TRADING</div>
      <div class="brand-sub">Négoce, distribution et transport d'hydrocarbures — Côte d'Ivoire</div>
    </div>
    <div class="doctype">
      BON DE LIVRAISON
      <div class="docnum">${esc(d.reference)}</div>
    </div>
  </div>

  ${!d.isDeliveredVolumeAuthoritative ? '<div class="banner">VOLUME PRÉVISIONNEL — AUCUN RELEVÉ CONTRADICTOIRE NE FAIT ENCORE FOI</div>' : ''}

  <div class="meta">
    <div class="block">
      <div class="label">Client</div>
      <div class="value">${esc(d.clientLegalName)}</div>
      ${d.clientTaxpayerAccountNumber ? `<div>NCC : ${esc(d.clientTaxpayerAccountNumber)}</div>` : ''}
    </div>
    <div class="block">
      <div class="label">Affaire</div>
      <div class="value">${d.dealReference ? esc(d.dealReference) : '-'}</div>
    </div>
    <div class="block">
      <div class="label">Opération</div>
      <div class="value">${esc(d.operationReference)}</div>
    </div>
    <div class="block">
      <div class="label">Date de livraison</div>
      <div class="value">${fmtDate(d.actualDischargeDate)}</div>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr><th>Désignation</th><th>Origine</th><th>Destination</th><th class="num">Quantité livrée</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(d.productName)}</td>
        <td>${esc(d.originLocation)}</td>
        <td>${esc(d.destinationLocation)}</td>
        <td class="num">${Number(d.deliveredVolume).toLocaleString('fr-FR')} ${esc(d.uom)}</td>
      </tr>
    </tbody>
  </table>

  <h2 class="section">Transport</h2>
  <div class="transport-grid">
    <div class="block">
      <div class="label">Mode</div>
      <div class="value">${TRANSPORT_LABEL[d.transportMode] ?? esc(d.transportMode)}</div>
    </div>
    <div class="block">
      <div class="label">Transporteur</div>
      <div class="value">${d.carrierName ? esc(d.carrierName) : '-'}</div>
    </div>
    <div class="block">
      <div class="label">Véhicule</div>
      <div class="value">${d.vehicleRegistration ? esc(d.vehicleRegistration) : d.vehicleIdentifier ? esc(d.vehicleIdentifier) : '-'}</div>
    </div>
    <div class="block">
      <div class="label">Chauffeur</div>
      <div class="value">${d.driverName ? esc(d.driverName) : '-'}</div>
    </div>
    <div class="block">
      <div class="label">Chargement</div>
      <div class="value">${fmtDate(d.actualLoadingDate)}</div>
    </div>
  </div>

  <div class="signoff">
    <div class="who">
      <div class="cap">Agent terrain</div>
      <div class="line">${d.fieldAgentName ? esc(d.fieldAgentName) : ''}</div>
    </div>
    <div class="who">
      <div class="cap">Représentant du client</div>
      <div class="line">Nom, qualité, signature</div>
    </div>
  </div>

  <div class="footer">
    <div class="legal">
      Bon de livraison engageant Elyon Trading et le client (§ 12.2) : scellé dès que l'agent
      terrain ET le représentant du client l'ont tous deux signé. Toute correction ultérieure fait
      l'objet d'un document distinct portant la mention « annule et remplace ». L'authenticité de
      cet exemplaire est vérifiable au lien ci-contre.
    </div>
    <div class="qr">
      <img src="${d.qrDataUri}" alt="QR d'authenticité">
      <div class="cap">${esc(d.verifyUrl)}</div>
    </div>
  </div>

</body>
</html>`;
}
