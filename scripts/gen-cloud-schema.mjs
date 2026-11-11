// scripts/gen-cloud-schema.mjs
// Rigenera src/services/cloud-schema.js dallo schema reale di Supabase.
// Uso: l'output JSON del tool "list_tables (verbose)" di Supabase → node scripts/gen-cloud-schema.mjs <file.json>
// (oppure da SQL: select table_name, column_name, data_type, is_nullable, column_default, is_generated from information_schema.columns ...)
import { readFileSync, writeFileSync } from 'node:fs';

const SYNCED = [
  // ordine = dipendenze: i padri prima dei figli (l'eliminazione usa l'ordine inverso)
  'settings', 'clients', 'services_catalog', 'quotes', 'quote_items', 'quote_item_images', 'quote_extra_services',
  'payments', 'todos', 'appointments', 'finance_transactions', 'trading_items',
  'brain_memories', 'brain_nodes', 'brain_facts', 'brain_edges',
  'body_exercise_columns', 'body_daily_logs', 'body_workout_entries', 'ai_note_queue',
];

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const data = JSON.parse(raw[0].text);
const out = {};
for (const name of SYNCED) {
  const t = data.tables.find(x => x.name === `public.${name}`);
  if (!t) throw new Error(`Tabella mancante: ${name}`);
  const columns = {};
  for (const c of t.columns) {
    columns[c.name] = {
      t: c.format.replace(/^_/, '') + (c.format.startsWith('_') ? '[]' : ''),
      n: c.options.includes('nullable'),
      d: c.default_value !== undefined,
      g: c.options.includes('generated') || (c.options.includes('updatable') ? false : true),
    };
  }
  out[name] = columns;
}

const body = `// src/services/cloud-schema.js
// GENERATO da scripts/gen-cloud-schema.mjs a partire dallo schema reale di Supabase. Non modificare a mano.
// t = tipo Postgres, n = nullable, d = ha un valore di default, g = colonna generata/non scrivibile.

export const SYNCED_TABLES = ${JSON.stringify(SYNCED)};

export const CLOUD_SCHEMA = ${JSON.stringify(out, null, 1)};
`;
writeFileSync(new URL('../src/services/cloud-schema.js', import.meta.url), body);
console.log('cloud-schema.js generato per', SYNCED.length, 'tabelle');
