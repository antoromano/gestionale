// scripts/sync-edge-shared.mjs
// Le Edge Function non possono importare da src/: le copie condivise si generano da qui (fonte unica = src/).
// Eseguire dopo ogni modifica a src/utils/body-parser.js o src/services/gemini-core.js. Un test verifica che non ci sia deriva.
import { readFileSync, writeFileSync } from 'node:fs';

const COPIES = [
  ['src/utils/body-parser.js', 'supabase/functions/telegram-webhook/body-parser.js'],
  ['src/services/gemini-core.js', 'supabase/functions/telegram-webhook/gemini-core.js'],
  ['src/services/gemini-core.js', 'supabase/functions/gemini-assistant/gemini-core.js'],
];

export const HEADER = (from) => `// COPIA GENERATA da ${from} con scripts/sync-edge-shared.mjs: NON modificare qui.\n`;

for (const [from, to] of COPIES) {
  writeFileSync(new URL(`../${to}`, import.meta.url), HEADER(from) + readFileSync(new URL(`../${from}`, import.meta.url), 'utf8'));
  console.log(`${from} → ${to}`);
}
