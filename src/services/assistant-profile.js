// src/services/assistant-profile.js
// Profilo dell'assistente personale: come deve rispondere (regole generali + regole per ambito) e quali dati vivi
// del gestionale può leggere. Una sola riga per utente nella tabella brain_assistant_profiles (sincronizzata nel cloud).

import { store } from './store.js';
import { normalizeProfile } from './rag-core.js';

/** La riga salvata (la più recente), oppure null se non è mai stata toccata. */
export function getAssistantProfileRow() {
  const rows = (store.getAll('brain_assistant_profiles') || []);
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
}

/** Profilo completo e pronto all'uso (i campi mancanti prendono i valori di partenza; finanze spente se non accese). */
export function getAssistantProfile() {
  return normalizeProfile(getAssistantProfileRow());
}

/**
 * Salva il profilo. `patch` può contenere global_instructions, domain_rules, live_data_permissions (anche parziali).
 */
export function saveAssistantProfile(patch = {}) {
  const row = getAssistantProfileRow();
  const current = normalizeProfile(row);
  const next = {
    global_instructions: patch.global_instructions !== undefined ? String(patch.global_instructions).trim() : current.global_instructions,
    domain_rules: { ...current.domain_rules, ...(patch.domain_rules || {}) },
    live_data_permissions: { ...current.live_data_permissions, ...(patch.live_data_permissions || {}) },
  };
  // interruttori sempre booleani: "acceso" solo se esplicitamente true
  for (const k of Object.keys(next.live_data_permissions)) next.live_data_permissions[k] = next.live_data_permissions[k] === true;
  if (row) return store.update('brain_assistant_profiles', row.id, next);
  return store.create('brain_assistant_profiles', next);
}
