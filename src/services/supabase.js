// src/services/supabase.js
// Supabase Client Wrapper con supporto Auth, Storage e Edge Functions

import { createClient } from '@supabase/supabase-js';
import { store } from './store.js';
import { SUPABASE_URL, SUPABASE_KEY, IS_TEST_ENV } from './config.js';

let supabaseInstance = null;
let injectedClient = null;

/** Solo per i test: sostituisce il client Supabase con uno finto. */
export function setSupabaseForTests(client) {
  injectedClient = client;
}

export function getSupabase() {
  if (injectedClient) return injectedClient;

  const settings = store.getSettings();
  const url = settings.supabase_url || (IS_TEST_ENV ? '' : SUPABASE_URL);
  const anonKey = settings.supabase_anon_key || (IS_TEST_ENV ? '' : SUPABASE_KEY);

  if (!url || !anonKey) {
    return null;
  }

  if (!supabaseInstance || supabaseInstance.supabaseUrl !== url) {
    try {
      supabaseInstance = createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
    } catch (err) {
      console.warn('Errore inizializzazione Supabase client:', err);
      return null;
    }
  }

  return supabaseInstance;
}

export async function uploadQuoteImageToStorage(file, userId) {
  const supabase = getSupabase();
  if (!supabase) {
    // Fallback: se Supabase non è ancora configurato, converte in data URL Base64
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const fileExt = file.name.split('.').pop();
  const filePath = `${userId || 'anonymous'}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from('quote-attachments')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) {
    throw error;
  }

  const { data: urlData } = supabase.storage
    .from('quote-attachments')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}
