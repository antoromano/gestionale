// src/utils/indexed-db.js
import { openDB } from 'idb';

const DB_NAME = 'gestionale_local_db';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Store per le bozze dei preventivi (testo, voci, immagini base64)
        if (!db.objectStoreNames.contains('quote_drafts')) {
          db.createObjectStore('quote_drafts', { keyPath: 'id' });
        }
        // Store per file/immagini pesanti locali
        if (!db.objectStoreNames.contains('cached_attachments')) {
          db.createObjectStore('cached_attachments', { keyPath: 'id' });
        }
        // Store per note audio e registrazioni vocali temporanee
        if (!db.objectStoreNames.contains('temp_audio')) {
          db.createObjectStore('temp_audio', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveQuoteDraft(draftId, quoteData) {
  try {
    const db = await getDB();
    const payload = {
      id: draftId || 'new_quote_draft',
      updatedAt: new Date().toISOString(),
      data: quoteData,
    };
    await db.put('quote_drafts', payload);
    return true;
  } catch (err) {
    console.error('Errore nel salvataggio della bozza su IndexedDB:', err);
    return false;
  }
}

export async function getQuoteDraft(draftId = 'new_quote_draft') {
  try {
    const db = await getDB();
    const record = await db.get('quote_drafts', draftId);
    return record ? record.data : null;
  } catch (err) {
    console.error('Errore nel recupero della bozza da IndexedDB:', err);
    return null;
  }
}

export async function deleteQuoteDraft(draftId = 'new_quote_draft') {
  try {
    const db = await getDB();
    await db.delete('quote_drafts', draftId);
    return true;
  } catch (err) {
    console.error('Errore nella rimozione della bozza da IndexedDB:', err);
    return false;
  }
}

export async function listQuoteDrafts() {
  try {
    const db = await getDB();
    return await db.getAll('quote_drafts');
  } catch (err) {
    console.error('Errore nella lettura delle bozze:', err);
    return [];
  }
}
