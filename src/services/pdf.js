// src/services/pdf.js
// Generatore PDF preventivi in duplice versione: Digitale e Stampa
// Con immagini affiancate per singola voce, gestione multipagina e nome file normalizzato

import { formatCurrency, formatDate, sanitizeFileName } from '../utils/formatters.js';
import { calculateQuoteTotals } from '../utils/calculations.js';
import { store } from './store.js';

/**
 * Costruisce il nome del file conforme alla specifica:
 * "Preventivo - Numero - Nome Cognome - Azienda.pdf"
 */
export function buildQuotePdfFileName(quote, client) {
  const num = quote.quote_number || 'Bozza';
  let personName = '';
  let companyName = '';

  if (client) {
    personName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
    companyName = client.company_name || '';
  } else if (quote.recipient_manual) {
    personName = `${quote.recipient_manual.first_name || ''} ${quote.recipient_manual.last_name || ''}`.trim();
    companyName = quote.recipient_manual.company_name || '';
  }

  const parts = ['Preventivo', num];
  if (personName) parts.push(personName);
  if (companyName && companyName !== personName) parts.push(companyName);

  const rawName = parts.filter(Boolean).join(' - ') + '.pdf';
  return sanitizeFileName(rawName);
}

/**
 * Genera l'HTML completo per la stampa / salvataggio PDF
 * @param {'digitale'|'stampa'} mode
 */
export function generateQuoteHtml({ quote, items = [], extraServices = [], client, mode = 'stampa' }) {
  const settings = store.getSettings();
  const totals = calculateQuoteTotals(quote, items, extraServices);

  const isDigital = mode === 'digitale';
  const primaryColor = settings.primary_color || '#1e293b';
  const accentColor = settings.accent_color || '#2563eb';

  // Destinatario
  const recipientName = client
    ? (client.company_name ? `${client.company_name} (Ref: ${client.first_name} ${client.last_name})` : `${client.first_name} ${client.last_name}`)
    : (quote.recipient_manual?.company_name || `${quote.recipient_manual?.first_name || ''} ${quote.recipient_manual?.last_name || ''}`.trim() || 'Spett.le Cliente');

  const recipientAddress = client?.address || quote.recipient_manual?.address || '';
  const recipientCity = client ? `${client.postal_code || ''} ${client.city || ''}`.trim() : (quote.recipient_manual?.city || '');
  const recipientVat = client?.vat_number || client?.fiscal_code || quote.recipient_manual?.vat_number || '';

  // Stili grafici
  const styles = `
    @page {
      size: A4;
      margin: 15mm 15mm 20mm 15mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: ${isDigital ? '#f8fafc' : '#1e293b'};
      background-color: ${isDigital ? primaryColor : '#ffffff'};
      padding: 20px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf-container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 25px;
      padding-bottom: 20px;
      border-bottom: 2px solid ${isDigital ? 'rgba(255,255,255,0.2)' : '#e2e8f0'};
    }
    .brand-section {
      max-width: 50%;
    }
    .brand-logo {
      max-height: 60px;
      max-width: 180px;
      object-fit: contain;
      margin-bottom: 8px;
    }
    .brand-name {
      font-size: 20px;
      font-weight: 700;
      color: ${isDigital ? '#ffffff' : primaryColor};
      margin-bottom: 4px;
    }
    .brand-details {
      font-size: 11px;
      color: ${isDigital ? '#cbd5e1' : '#64748b'};
      line-height: 1.4;
    }
    .quote-meta {
      text-align: right;
    }
    .quote-title-badge {
      display: inline-block;
      font-size: 20px;
      font-weight: 800;
      color: ${isDigital ? '#ffffff' : accentColor};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .quote-number {
      font-size: 14px;
      font-weight: 600;
      color: ${isDigital ? '#e2e8f0' : '#334155'};
      margin-top: 4px;
    }
    .quote-date {
      font-size: 11px;
      color: ${isDigital ? '#94a3b8' : '#64748b'};
      margin-top: 2px;
    }

    .parties-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 25px;
      padding: 14px;
      background: ${isDigital ? 'rgba(255,255,255,0.06)' : '#f8fafc'};
      border-radius: 6px;
      border: 1px solid ${isDigital ? 'rgba(255,255,255,0.1)' : '#e2e8f0'};
    }
    .party-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: ${isDigital ? '#94a3b8' : '#64748b'};
      margin-bottom: 6px;
    }
    .party-name {
      font-size: 14px;
      font-weight: 700;
      color: ${isDigital ? '#ffffff' : '#0f172a'};
    }
    .party-info {
      font-size: 12px;
      color: ${isDigital ? '#cbd5e1' : '#475569'};
      margin-top: 2px;
    }

    .doc-subject {
      margin-bottom: 20px;
      padding: 10px 14px;
      background: ${isDigital ? 'rgba(255,255,255,0.08)' : '#f1f5f9'};
      border-left: 4px solid ${accentColor};
      border-radius: 0 4px 4px 0;
    }
    .doc-subject-title {
      font-size: 14px;
      font-weight: 700;
      color: ${isDigital ? '#ffffff' : '#0f172a'};
    }

    /* Tabella Voci Preventivo con immagini affiancate */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 25px;
    }
    .items-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 10px 12px;
      border-bottom: 2px solid ${isDigital ? 'rgba(255,255,255,0.2)' : '#cbd5e1'};
      color: ${isDigital ? '#cbd5e1' : '#475569'};
    }
    .items-table td {
      padding: 12px;
      vertical-align: top;
      border-bottom: 1px solid ${isDigital ? 'rgba(255,255,255,0.1)' : '#e2e8f0'};
      page-break-inside: avoid;
    }
    .item-row {
      page-break-inside: avoid;
    }
    .item-desc-col {
      width: 60%;
    }
    .item-title {
      font-weight: 600;
      font-size: 13px;
      color: ${isDigital ? '#ffffff' : '#0f172a'};
      margin-bottom: 4px;
    }
    .item-details {
      font-size: 11px;
      color: ${isDigital ? '#94a3b8' : '#64748b'};
      margin-bottom: 8px;
      white-space: pre-line;
    }
    .item-gallery {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .item-img-card {
      display: flex;
      flex-direction: column;
      width: 90px;
      background: ${isDigital ? 'rgba(255,255,255,0.1)' : '#ffffff'};
      border: 1px solid ${isDigital ? 'rgba(255,255,255,0.15)' : '#e2e8f0'};
      border-radius: 4px;
      overflow: hidden;
    }
    .item-img-card img {
      width: 100%;
      height: 70px;
      object-fit: cover;
    }
    .item-img-caption {
      font-size: 9px;
      padding: 3px;
      text-align: center;
      color: ${isDigital ? '#cbd5e1' : '#64748b'};
      word-break: break-word;
      line-height: 1.1;
    }

    .item-price-col {
      text-align: right;
      white-space: nowrap;
    }
    .item-final-price {
      font-size: 14px;
      font-weight: 700;
      color: ${isDigital ? '#ffffff' : '#0f172a'};
    }
    .item-discount-note {
      font-size: 10px;
      color: ${isDigital ? '#f87171' : '#dc2626'};
      margin-top: 2px;
    }
    .item-freebie-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      color: #16a34a;
      background: rgba(22, 163, 74, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      margin-top: 2px;
    }

    /* Riepilogo Totali */
    .totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    .totals-box {
      width: 320px;
      background: ${isDigital ? 'rgba(255,255,255,0.06)' : '#f8fafc'};
      border: 1px solid ${isDigital ? 'rgba(255,255,255,0.15)' : '#e2e8f0'};
      border-radius: 6px;
      padding: 14px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 12px;
      color: ${isDigital ? '#cbd5e1' : '#475569'};
    }
    .totals-row.final {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 2px solid ${isDigital ? 'rgba(255,255,255,0.2)' : '#cbd5e1'};
      font-size: 16px;
      font-weight: 800;
      color: ${isDigital ? '#ffffff' : accentColor};
    }

    /* Condizioni contrattuali e note */
    .terms-section {
      margin-top: 20px;
      padding: 14px;
      background: ${isDigital ? 'rgba(255,255,255,0.04)' : '#fdfdfd'};
      border: 1px solid ${isDigital ? 'rgba(255,255,255,0.1)' : '#e2e8f0'};
      border-radius: 6px;
      font-size: 11px;
      color: ${isDigital ? '#94a3b8' : '#64748b'};
      page-break-inside: avoid;
    }
    .terms-title {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 10px;
      margin-bottom: 6px;
      color: ${isDigital ? '#cbd5e1' : '#334155'};
    }

    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 10px;
      color: ${isDigital ? '#94a3b8' : '#94a3b8'};
      page-break-inside: avoid;
    }
  `;

  // Righe Voci
  const itemsHtml = items.map(item => {
    const qty = Number(item.quantity) || 1;
    const unitPrice = Number(item.unit_price) || 0;
    const discount = Number(item.discount_percent) || 0;
    const isFreebie = Boolean(item.is_freebie);
    const gross = qty * unitPrice;
    const net = gross * (1 - discount / 100);

    // Galleria immagini per questa specifica voce
    const imagesHtml = (item.images && item.images.length > 0)
      ? `
        <div class="item-gallery">
          ${item.images.map(img => `
            <div class="item-img-card">
              <img src="${img.file_url}" alt="${img.caption || 'Immagine voce'}" />
              ${img.caption ? `<div class="item-img-caption">${img.caption}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `
      : '';

    let priceContent = '';
    if (isFreebie) {
      priceContent = `
        <div class="item-freebie-badge">Omaggio</div>
        <div class="item-details" style="margin-top: 2px;">(Valore: ${formatCurrency(gross)})</div>
      `;
    } else {
      priceContent = `
        <div class="item-final-price">${formatCurrency(net)}</div>
        ${discount > 0 ? `<div class="item-discount-note">Sconto del ${discount}% su ${formatCurrency(gross)}</div>` : ''}
      `;
    }

    return `
      <tr class="item-row">
        <td class="item-desc-col">
          <div class="item-title">${item.description}</div>
          ${item.visible_details ? `<div class="item-details">${item.visible_details}</div>` : ''}
          ${imagesHtml}
        </td>
        <td style="text-align: center; font-size: 12px;">${qty} ${item.unit || 'pz'}</td>
        <td style="text-align: right; font-size: 12px;">${formatCurrency(unitPrice)}</td>
        <td class="item-price-col">
          ${priceContent}
        </td>
      </tr>
    `;
  }).join('');

  // Sezione Totale (mostrata solo se show_total_in_pdf è vero)
  let totalsHtml = '';
  if (quote.show_total_in_pdf !== false) {
    totalsHtml = `
      <div class="totals-wrapper">
        <div class="totals-box">
          <div class="totals-row">
            <span>Subtotale voci:</span>
            <span>${formatCurrency(totals.itemsSubtotal)}</span>
          </div>

          ${quote.global_discount_percent > 0 ? `
            <div class="totals-row" style="color: ${isDigital ? '#f87171' : '#dc2626'};">
              <span>Sconto globale (${quote.global_discount_percent}%):</span>
              <span>-${formatCurrency(totals.globalDiscountAmount)}</span>
            </div>
          ` : ''}

          ${totals.fiscalLevyAmount > 0 ? `
            <div class="totals-row">
              <span>${quote.fiscal_levy_name || 'Cassa Previdenziale'} (${quote.fiscal_levy_percent}%):</span>
              <span>+${formatCurrency(totals.fiscalLevyAmount)}</span>
            </div>
          ` : ''}

          ${totals.vatAmount > 0 ? `
            <div class="totals-row">
              <span>IVA (${quote.vat_percent}%):</span>
              <span>+${formatCurrency(totals.vatAmount)}</span>
            </div>
          ` : ''}

          <div class="totals-row final">
            <span>${totals.hasManualAgreedTotal ? 'Totale concordato:' : 'Totale preventivo:'}</span>
            <span>${formatCurrency(totals.agreedBaseTotal)}</span>
          </div>
        </div>
      </div>
    `;
  }

  const conditions = quote.conditions || settings.quote_default_conditions || '';

  return `
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <meta charset="UTF-8">
      <title>${quote.title || 'Preventivo'} - ${quote.quote_number || ''}</title>
      <style>${styles}</style>
    </head>
    <body>
      <div class="pdf-container">
        <!-- Intestazione -->
        <div class="header-row">
          <div class="brand-section">
            ${settings.logo_url ? `<img src="${settings.logo_url}" alt="Logo" class="brand-logo" />` : ''}
            <div class="brand-name">${settings.business_name || settings.app_name || 'Gestionale'}</div>
            <div class="brand-details">
              ${settings.owner_name ? `<div>${settings.owner_name}</div>` : ''}
              ${settings.address ? `<div>${settings.address} - ${settings.postal_code || ''} ${settings.city || ''}</div>` : ''}
              ${settings.vat_number ? `<div>P.IVA: ${settings.vat_number}</div>` : ''}
              ${settings.fiscal_code ? `<div>C.F.: ${settings.fiscal_code}</div>` : ''}
              ${settings.email ? `<div>Email: ${settings.email}</div>` : ''}
              ${settings.phone ? `<div>Tel: ${settings.phone}</div>` : ''}
            </div>
          </div>
          <div class="quote-meta">
            <div class="quote-title-badge">PREVENTIVO</div>
            <div class="quote-number">N. ${quote.quote_number || 'Bozza'}</div>
            <div class="quote-date">Data: ${formatDate(quote.issue_date || new Date())}</div>
            ${quote.valid_until ? `<div class="quote-date">Validità fino al: ${formatDate(quote.valid_until)}</div>` : ''}
          </div>
        </div>

        <!-- Sezione Parti (Emittente / Destinatario) -->
        <div class="parties-grid">
          <div>
            <div class="party-title">Emittente</div>
            <div class="party-name">${settings.business_name || settings.owner_name || 'Professionista'}</div>
            <div class="party-info">${settings.email || ''} ${settings.phone ? `• ${settings.phone}` : ''}</div>
          </div>
          <div>
            <div class="party-title">Destinatario</div>
            <div class="party-name">${recipientName}</div>
            ${recipientAddress ? `<div class="party-info">${recipientAddress}</div>` : ''}
            ${recipientCity ? `<div class="party-info">${recipientCity}</div>` : ''}
            ${recipientVat ? `<div class="party-info">C.F./P.IVA: ${recipientVat}</div>` : ''}
          </div>
        </div>

        <!-- Oggetto -->
        <div class="doc-subject">
          <div class="doc-subject-title">Oggetto: ${quote.title || 'Descrizione servizi'}</div>
        </div>

        <!-- Voci Preventivo -->
        <table class="items-table">
          <thead>
            <tr>
              <th>Descrizione</th>
              <th style="text-align: center; width: 60px;">Q.tà</th>
              <th style="text-align: right; width: 90px;">Prezzo Un.</th>
              <th style="text-align: right; width: 110px;">Totale</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml || '<tr><td colspan="4" style="text-align:center; padding: 20px;">Nessuna voce inserita</td></tr>'}
          </tbody>
        </table>

        <!-- Totali (se abilitati) -->
        ${totalsHtml}

        <!-- Condizioni contrattuali e note -->
        ${conditions ? `
          <div class="terms-section">
            <div class="terms-title">Condizioni di fornitura e pagamento</div>
            <div>${conditions.replace(/\n/g, '<br>')}</div>
          </div>
        ` : ''}

        <!-- Footer -->
        <div class="footer">
          Documento generato il ${formatDate(new Date())} • ${settings.business_name || settings.app_name || 'Gestionale'}
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Apre la finestra di stampa / download PDF pronta per la stampa da desktop, iOS e Android.
 */
export function openPdfPrintWindow({ quote, items, extraServices, client, mode = 'stampa' }) {
  const html = generateQuoteHtml({ quote, items, extraServices, client, mode });
  const fileName = buildQuotePdfFileName(quote, client);

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Consenti i popup per visualizzare e stampare il PDF.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.title = fileName;
  printWindow.document.close();

  // Attende il caricamento delle immagini e font prima di avviare il dialogo di stampa
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 400);
  };
}
