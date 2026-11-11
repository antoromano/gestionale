// src/services/note-queue-sync.js
// Sincronizzazione best-effort della Coda Appunti con la tabella Supabase `ai_note_queue`
// (stessa filosofia local-first di brain.js: se Supabase non è configurato o l'RLS blocca, non succede nulla).
//   • PUSH: ogni nota creata/elaborata in locale viene replicata (così /digest da Telegram vede anche le note web).
//   • PULL: le note arrivate via Telegram (/queue) vengono scaricate nello store locale.

import { store } from './store.js';
import { getSupabase } from './supabase.js';

let isPulling = false;

async function pushNote(note) {
  const supabase = getSupabase();
  if (!supabase || !note) return;
  try {
    await supabase.from('ai_note_queue').upsert({
      id: note.id,
      content: note.content,
      source: note.source,
      status: note.status,
      processed_at: note.processed_at || null,
      created_at: note.created_at,
    });
  } catch (err) {
    console.warn('Sync Supabase ai_note_queue ignorato (modalità local-first):', err.message);
  }
}

store.onEntityChange((collection, _action, item) => {
  if (collection === 'ai_note_queue' && !isPulling) pushNote(item);
});

/**
 * Scarica da Supabase le note in coda mancanti in locale e allinea lo stato delle note già elaborate altrove.
 * @returns {Promise<boolean>} true se lo store locale è cambiato
 */
export async function syncQueueWithSupabase() {
  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    const { data, error } = await supabase
      .from('ai_note_queue')
      .select('id, content, source, status, processed_at, created_at')
      .order('created_at', { ascending: true })
      .limit(500);
    if (error || !Array.isArray(data)) return false;

    isPulling = true;
    let changed = false;
    const local = new Map(store.getAll('ai_note_queue', true).map(n => [n.id, n]));

    store.runBatch(() => {
      for (const remote of data) {
        const existing = local.get(remote.id);
        if (!existing) {
          if (remote.status === 'queued') {
            store.create('ai_note_queue', {
              id: remote.id,
              content: remote.content,
              source: remote.source,
              status: 'queued',
              created_at: remote.created_at,
            });
            changed = true;
          }
        } else if (existing.status !== 'processed' && remote.status === 'processed') {
          store.update('ai_note_queue', remote.id, { status: 'processed', processed_at: remote.processed_at });
          changed = true;
        }
      }
    });
    return changed;
  } catch (err) {
    console.warn('Pull ai_note_queue ignorato (modalità local-first):', err.message);
    return false;
  } finally {
    isPulling = false;
  }
}
