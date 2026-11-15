// tests/helpers/stub-openai.js
// OpenAI finto per i test: elenco modelli, risposte JSON e vettori di ricerca. I vettori sono quelli deterministici
// dell'app (stesse parole → vettori vicini), così la ricerca "per significato" si comporta in modo sensato.
import { vi } from 'vitest';
import { store } from '../../src/services/store.js';
import { clearOpenAICache } from '../../src/services/ai-providers.js';
import { computeLocalEmbedding } from '../../src/services/brain.js';

/**
 * @param {(body:object, text:string) => object} generate riceve la richiesta e restituisce il JSON che "l'IA" risponde
 * @returns {{fn:Function, calls:{generate:object[], embed:object[]}}}
 */
export function stubOpenAI(generate = () => ({}), { embedFail = false, generateFail = null } = {}) {
  clearOpenAICache();
  store.updateSettings({ openai_api_key: 'sk-test', gemini_api_key: '' });
  const calls = { generate: [], embed: [] };
  const fn = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }] }) };
    if (u.endsWith('/embeddings')) {
      const body = JSON.parse(init.body);
      calls.embed.push(body);
      if (embedFail) return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'errore simulato' } }) };
      const input = Array.isArray(body.input) ? body.input : [body.input];
      return { ok: true, json: async () => ({ data: input.map((t, index) => ({ index, embedding: computeLocalEmbedding(t) })), usage: { total_tokens: 10 * input.length } }) };
    }
    if (u.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body);
      const system = body.messages.find(m => m.role === 'system')?.content || '';
      const user = body.messages.find(m => m.role === 'user')?.content;
      const text = typeof user === 'string' ? user : (user || []).map(p => p.text || '').join('\n');
      calls.generate.push({ system, text, body });
      if (generateFail) return { ok: false, status: generateFail, text: async () => JSON.stringify({ error: { message: 'errore simulato' } }) };
      const out = generate({ system, text, body });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
    }
    return { ok: false, status: 404, text: async () => '' };
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}
