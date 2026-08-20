/**
 * GABARIT PDF DE FACTURATION (§ 9.3, § 12).
 *
 * Un document HTML autonome — CSS inline, aucune ressource externe — rendu
 * par Chromium headless (`PdfRendererService`). Une seule mise en page pour
 * les quatre natures de pièce (proforma, simple, FNE, avoir) : les mentions
 * qui varient sont conditionnelles, la charpente ne l'est pas.
 *
 * ⚠️ L'EN-TÊTE VENDEUR EST MINIMAL PAR MANQUE DE DONNÉES, PAS PAR CHOIX.
 *    Aucune fiche « société » (adresse, RCCM, capital) n'existe dans le
 *    système à ce jour — seul le nom commercial l'est. À enrichir dès qu'un
 *    référentiel « identité légale de l'émetteur » existera.
 */

export interface InvoicePdfData {
  number: string;
  type: 'PROFORMA' | 'SIMPLE' | 'FNE' | 'CREDIT_NOTE';
  issueDate: string | null;
  dueDate: string | null;
  billedVolume: string;
  uom: string;
  unitPrice: string;
  currencyCode: string;
  grossAmount: string;
  discountAmount: string;
  totalAmount: string;
  vatAmount: string;
  isVatApplicable: boolean;
  vatRatePct: string;
  printedTaxRegime: 'HT' | 'TTC';
  vatExemptionReference: string | null;
  fiscalReference: string | null;
  correctedInvoiceNumber: string | null;
  partnerLegalName: string;
  partnerTaxpayerAccountNumber: string | null;
  partnerCountryCode: string;
  /** Absente pour une proforma répondant à une demande de cotation, avant conversion en affaire. */
  dealReference: string | null;
  productName: string;
  verifyUrl: string;
  qrDataUri: string;
}

const TYPE_LABEL: Record<InvoicePdfData['type'], string> = {
  PROFORMA: 'FACTURE PROFORMA',
  SIMPLE: 'FACTURE',
  FNE: 'FACTURE NORMALISÉE ÉLECTRONIQUE',
  CREDIT_NOTE: 'AVOIR',
};

function fmtMoney(value: string, currency: string): string {
  const n = Number(value);
  const decimals = currency === 'XOF' ? 0 : 2;
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderInvoiceHtml(d: InvoicePdfData): string {
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
  .doctype {
    text-align: right;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .docnum { font-family: "Courier New", monospace; font-size: 15px; margin-top: 4px; }
  .banner {
    background: #F5EAD2;
    border: 1px solid #9A6B12;
    color: #6B4A0C;
    padding: 8px 12px;
    font-weight: 700;
    text-align: center;
    margin-bottom: 16px;
    font-size: 11px;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .meta .block { flex: 1; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #7A8898; margin-bottom: 3px; }
  .value { font-size: 12px; font-weight: 600; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.lines th {
    text-align: left;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #7A8898;
    border-bottom: 1px solid #D3DAE2;
    padding: 6px 8px;
  }
  table.lines td { padding: 10px 8px; border-bottom: 1px solid #EEF1F5; font-size: 11.5px; }
  table.lines .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { width: 260px; margin-left: auto; margin-top: 14px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 11.5px; }
  .totals .row.total { border-top: 2px solid #17222E; font-weight: 700; font-size: 14px; padding-top: 8px; margin-top: 4px; }
  .footer {
    margin-top: 36px;
    padding-top: 14px;
    border-top: 1px solid #D3DAE2;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .footer .legal { font-size: 9px; color: #7A8898; max-width: 380px; line-height: 1.6; }
  .footer .qr { text-align: center; }
  .footer .qr img { width: 70px; height: 70px; }
  .exo { margin-top: 6px; font-size: 10px; color: #4C5A6B; }
</style>
</head>
<body>

  <div class="head">
    <div>
      <div class="brand">ELYON TRADING</div>
      <div class="brand-sub">Négoce, distribution et transport d'hydrocarbures · Côte d'Ivoire</div>
    </div>
    <div class="doctype">
      ${TYPE_LABEL[d.type]}
      <div class="docnum">${esc(d.number)}</div>
    </div>
  </div>

  ${d.type === 'PROFORMA' ? '<div class="banner">DOCUMENT PROFORMA – NON VALABLE COMME FACTURE DÉFINITIVE</div>' : ''}
  ${d.type === 'CREDIT_NOTE' && d.correctedInvoiceNumber ? `<div class="banner">AVOIR SUR LA PIÈCE ${esc(d.correctedInvoiceNumber)}</div>` : ''}

  <div class="meta">
    <div class="block">
      <div class="label">Client</div>
      <div class="value">${esc(d.partnerLegalName)}</div>
      ${d.partnerTaxpayerAccountNumber ? `<div>NCC : ${esc(d.partnerTaxpayerAccountNumber)}</div>` : ''}
      <div>Pays : ${esc(d.partnerCountryCode)}</div>
    </div>
    <div class="block">
      <div class="label">Affaire</div>
      <div class="value">${d.dealReference ? esc(d.dealReference) : 'en réponse à une demande de cotation'}</div>
    </div>
    <div class="block">
      <div class="label">Date d'émission</div>
      <div class="value">${fmtDate(d.issueDate)}</div>
      ${d.dueDate ? `<div class="label" style="margin-top:6px">Échéance</div><div class="value">${fmtDate(d.dueDate)}</div>` : ''}
    </div>
    ${d.fiscalReference ? `<div class="block"><div class="label">Référence DGI</div><div class="value">${esc(d.fiscalReference)}</div></div>` : ''}
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>Désignation</th>
        <th class="num">Quantité</th>
        <th class="num">Prix unitaire ${d.printedTaxRegime}</th>
        <th class="num">Montant</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(d.productName)}</td>
        <td class="num">${Number(d.billedVolume).toLocaleString('fr-FR')} ${esc(d.uom)}</td>
        <td class="num">${fmtMoney(d.unitPrice, d.currencyCode)}</td>
        <td class="num">${fmtMoney(d.grossAmount, d.currencyCode)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    ${Number(d.discountAmount) > 0 ? `<div class="row"><span>Remise</span><span>− ${fmtMoney(d.discountAmount, d.currencyCode)}</span></div>` : ''}
    <div class="row total"><span>Total ${d.printedTaxRegime}</span><span>${fmtMoney(d.totalAmount, d.currencyCode)}</span></div>
    ${
      d.isVatApplicable
        ? `<div class="row"><span>dont TVA (${Number(d.vatRatePct)} %)</span><span>${fmtMoney(d.vatAmount, d.currencyCode)}</span></div>`
        : `<div class="row"><span>TVA</span><span>non applicable</span></div>`
    }
  </div>

  ${
    !d.isVatApplicable && d.vatExemptionReference
      ? `<p class="exo">Exonération de TVA - référence : ${esc(d.vatExemptionReference)}</p>`
      : ''
  }

  <div class="footer">
    <div class="legal">
      Pièce émise par Elyon Trading. Scellée et horodatée par le système à sa génération ; toute
      correction ultérieure fait l'objet d'un document distinct portant la mention « annule et
      remplace », jamais d'une modification silencieuse. L'authenticité de cet exemplaire est
      vérifiable en scannant le QR code ci-contre.
    </div>
    <div class="qr">
      <img src="${d.qrDataUri}" alt="QR d'authenticité">
    </div>
  </div>

</body>
</html>`;
}
