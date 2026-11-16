// src/services/auth.js
// Login a utente unico (email + password) su Supabase Auth.

import { getSupabase } from './supabase.js';

function friendly(message = '') {
  if (/invalid login credentials/i.test(message)) return 'Email o password non corretti.';
  if (/registrazioni chiuse/i.test(message) || /database error saving new user/i.test(message)) {
    return 'Registrazioni chiuse: esiste già un account. Accedi con quello.';
  }
  if (/password should be at least/i.test(message)) return 'La password deve avere almeno 6 caratteri.';
  if (/already registered|already exists/i.test(message)) return 'Questa email è già registrata: accedi.';
  if (/rate limit/i.test(message)) return 'Troppi tentativi ravvicinati: aspetta un minuto e riprova.';
  if (/failed to fetch|network/i.test(message)) return 'Nessuna connessione a Internet.';
  return message || 'Operazione non riuscita.';
}

export async function getSession() {
  const client = getSupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data?.session || null;
}

export async function signIn(email, password) {
  const client = getSupabase();
  if (!client) throw new Error('Cloud non configurato.');
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendly(error.message));
  return data.session;
}

/** Prima registrazione. Il database accetta un solo utente e lo conferma in automatico, poi si accede subito. */
export async function signUp(email, password) {
  const client = getSupabase();
  if (!client) throw new Error('Cloud non configurato.');
  const { error } = await client.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(friendly(error.message));
  return signIn(email, password);
}

export async function signOut() {
  const client = getSupabase();
  if (client) await client.auth.signOut();
}

export function onAuthChange(callback) {
  const client = getSupabase();
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data?.subscription?.unsubscribe?.();
}
