// src/services/config.js
// Configurazione del progetto cloud. La chiave "publishable" di Supabase è pubblica per progetto:
// la sicurezza dei dati è garantita dalle regole RLS e dal login, non dal nascondere questa chiave.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const DEFAULT_SUPABASE_URL = 'https://hbyqofpkkenzgbggvlch.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_UdPJ4ig-yExeAKzoD35B3g_KSs0uGJl';

export const SUPABASE_URL = env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

// Nei test non si apre mai una connessione reale a meno che non venga iniettata esplicitamente
export const IS_TEST_ENV = env.MODE === 'test';
