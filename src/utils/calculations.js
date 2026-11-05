// src/utils/calculations.js

/**
 * Calcola il prezzo finale di una singola voce di preventivo.
 */
export function calculateItemTotal(item) {
  if (!item) return 0;
  if (item.is_freebie) return 0;
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unit_price) || 0;
  const discount = Number(item.discount_percent) || 0;
  const gross = qty * price;
  const net = gross * (1 - discount / 100);
  return Math.max(0, Math.round(net * 100) / 100);
}

/**
 * Calcola il valore pieno di una voce se omaggio (per mostrare il valore regalato).
 */
export function calculateItemGrossValue(item) {
  if (!item) return 0;
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unit_price) || 0;
  return Math.round(qty * price * 100) / 100;
}

/**
 * Calcola il prospetto economico completo di un preventivo.
 */
export function calculateQuoteTotals(quote, items = [], extraServices = []) {
  const itemsSubtotal = (items || []).reduce((sum, it) => sum + calculateItemTotal(it), 0);

  const globalDiscountPercent = Number(quote?.global_discount_percent) || 0;
  const globalDiscountAmount = Math.round(itemsSubtotal * (globalDiscountPercent / 100) * 100) / 100;
  const subtotalAfterDiscount = Math.max(0, itemsSubtotal - globalDiscountAmount);

  // Oneri previdenziali / rivalsa configurabile
  let fiscalLevyAmount = 0;
  const fiscalLevyEnabled = Boolean(quote?.fiscal_levy_enabled);
  const fiscalLevyPercent = Number(quote?.fiscal_levy_percent) || 0;
  if (fiscalLevyEnabled && fiscalLevyPercent > 0) {
    fiscalLevyAmount = Math.round(subtotalAfterDiscount * (fiscalLevyPercent / 100) * 100) / 100;
  }

  // Base imponibile IVA
  const taxableForVat = subtotalAfterDiscount + fiscalLevyAmount;
  let vatAmount = 0;
  const vatEnabled = Boolean(quote?.vat_enabled);
  const vatPercent = Number(quote?.vat_percent) || 0;
  if (vatEnabled && vatPercent > 0) {
    vatAmount = Math.round(taxableForVat * (vatPercent / 100) * 100) / 100;
  }

  const computedMathematicalTotal = Math.round((taxableForVat + vatAmount) * 100) / 100;

  // Totale concordato: se specificato manualmente dall'utente ha la precedenza
  const hasManualAgreedTotal = quote?.agreed_total !== undefined && quote?.agreed_total !== null && quote?.agreed_total !== '';
  const agreedBaseTotal = hasManualAgreedTotal ? Number(quote.agreed_total) : computedMathematicalTotal;

  // Servizi extra: solo quelli 'approvati' aumentano il totale e il residuo!
  const approvedExtras = (extraServices || []).filter(e => e.status === 'approvato');
  const proposedExtras = (extraServices || []).filter(e => e.status === 'proposto');
  const rejectedExtras = (extraServices || []).filter(e => e.status === 'rifiutato');

  const extraApprovedTotal = approvedExtras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const extraProposedTotal = proposedExtras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const finalEffectiveTotal = Math.round((agreedBaseTotal + extraApprovedTotal) * 100) / 100;

  return {
    itemsSubtotal: Math.round(itemsSubtotal * 100) / 100,
    globalDiscountAmount,
    subtotalAfterDiscount: Math.round(subtotalAfterDiscount * 100) / 100,
    fiscalLevyAmount,
    vatAmount,
    computedMathematicalTotal,
    agreedBaseTotal,
    hasManualAgreedTotal,
    extraApprovedTotal,
    extraProposedTotal,
    finalEffectiveTotal,
  };
}

/**
 * Calcola la situazione pagamenti e il residuo per un preventivo.
 */
export function calculatePaymentBalance(effectiveTotal, payments = []) {
  let collectedAmount = 0;
  let expectedPendingAmount = 0;
  let refundsAmount = 0;

  for (const p of payments || []) {
    if (p.is_deleted) continue;
    const amount = Number(p.amount) || 0;
    if (p.status === 'incassato') {
      if (p.type === 'rimborso') {
        refundsAmount += amount;
        collectedAmount -= amount; // i rimborsi diminuiscono l'incassato effettivo
      } else {
        collectedAmount += amount;
      }
    } else if (p.status === 'previsto') {
      expectedPendingAmount += amount;
    }
  }

  collectedAmount = Math.round(collectedAmount * 100) / 100;
  const residualAmount = Math.max(0, Math.round((effectiveTotal - collectedAmount) * 100) / 100);

  return {
    collectedAmount,
    expectedPendingAmount,
    refundsAmount,
    residualAmount,
    isFullyPaid: residualAmount <= 0 && collectedAmount > 0,
  };
}

/**
 * Calcola i dati aggregati per la sezione Report evitando rigorosamente qualsiasi doppio conteggio,
 * e calcola le metriche MRR (Monthly Recurring Revenue) da contratti di manutenzione/canoni attivi.
 */
export function calculateFinancialReport({ quotes = [], payments = [], todos = [], expenses = [], clients = [], filterClientId = null, startDate = null, endDate = null }) {
  // Filtro preventivi
  const filteredQuotes = (quotes || []).filter(q => {
    if (q.is_deleted) return false;
    if (filterClientId && q.client_id !== filterClientId) return false;
    if (startDate && q.issue_date < startDate) return false;
    if (endDate && q.issue_date > endDate) return false;
    return true;
  });

  // Filtro pagamenti
  const filteredPayments = (payments || []).filter(p => {
    if (p.is_deleted) return false;
    if (filterClientId && p.client_id !== filterClientId) return false;
    const pDate = p.payment_date || p.due_date;
    if (startDate && pDate && pDate < startDate) return false;
    if (endDate && pDate && pDate > endDate) return false;
    return true;
  });

  // Filtro spese
  const filteredExpenses = (expenses || []).filter(e => {
    if (e.is_deleted) return false;
    if (filterClientId && e.client_id !== filterClientId) return false;
    if (startDate && e.date < startDate) return false;
    if (endDate && e.date > endDate) return false;
    return true;
  });

  // Filtro todos autonomi con compenso (esclusi quelli inclusi nei preventivi per evitare doppi conteggi!)
  const filteredAutonomousTodos = (todos || []).filter(t => {
    if (t.is_deleted) return false;
    if (filterClientId && t.client_id !== filterClientId) return false;
    const tDate = t.due_date ? t.due_date.split('T')[0] : null;
    if (startDate && tDate && tDate < startDate) return false;
    if (endDate && tDate && tDate > endDate) return false;
    return t.compensation_mode === 'autonomous' || t.compensation_mode === 'extra';
  });

  // Calcolo MRR (Monthly Recurring Revenue) da contratti di manutenzione / canoni
  let mrr = 0;
  let activeContractsCount = 0;
  const filteredClients = (clients || []).filter(c => {
    if (c.is_deleted) return false;
    if (filterClientId && c.id !== filterClientId) return false;
    return true;
  });

  for (const c of filteredClients) {
    const contracts = c.maintenance_contracts || c.tech_details?.maintenance_contracts || [];
    for (const contract of contracts) {
      if (contract.status === 'active') {
        const amt = Number(contract.amount) || 0;
        activeContractsCount++;
        if (contract.frequency === 'quarterly') {
          mrr += amt / 3;
        } else if (contract.frequency === 'annual') {
          mrr += amt / 12;
        } else {
          mrr += amt; // monthly default
        }
      }
    }
  }

  // Calcolo valore pattuito / ricavi concordati:
  // Preventivi accettati o inviati + Servizi extra approvati + To-do autonomi
  let agreedRevenue = 0;
  for (const q of filteredQuotes) {
    if (q.status !== 'rifiutato') {
      const qTotal = Number(q.agreed_total) || 0;
      agreedRevenue += qTotal;
    }
  }

  for (const t of filteredAutonomousTodos) {
    agreedRevenue += Number(t.compensation_amount) || 0;
  }

  // Incassi effettivi (denaro reale entrato in cassa al netto dei rimborsi)
  let collectedCash = 0;
  for (const p of filteredPayments) {
    if (p.status === 'incassato') {
      const amt = Number(p.amount) || 0;
      if (p.type === 'rimborso') {
        collectedCash -= amt;
      } else {
        collectedCash += amt;
      }
    }
  }

  // Incassi diretti registrati sui to-do autonomi (acconto/saldo) se non collegati a un record di pagamento preventivo
  for (const t of filteredAutonomousTodos) {
    if (!t.quote_id) {
      collectedCash += (Number(t.deposit_received) || 0) + (Number(t.balance_received) || 0);
    }
  }

  // Spese
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  mrr = Math.round(mrr * 100) / 100;

  // Residuo ancora da incassare
  const residualReceivables = Math.max(0, agreedRevenue - collectedCash);

  // Margine stimato su cassa reale
  const estimatedCashMargin = collectedCash - totalExpenses;
  // Margine stimato sul concordato
  const estimatedAgreedMargin = agreedRevenue - totalExpenses;

  return {
    agreedRevenue: Math.round(agreedRevenue * 100) / 100,
    collectedCash: Math.round(collectedCash * 100) / 100,
    residualReceivables: Math.round(residualReceivables * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    estimatedCashMargin: Math.round(estimatedCashMargin * 100) / 100,
    estimatedAgreedMargin: Math.round(estimatedAgreedMargin * 100) / 100,
    mrr,
    activeContractsCount,
    annualRecurringRevenue: Math.round(mrr * 12 * 100) / 100,
    quotesCount: filteredQuotes.length,
    paymentsCount: filteredPayments.length,
    expensesCount: filteredExpenses.length,
  };
}
