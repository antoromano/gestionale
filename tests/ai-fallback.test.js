// tests/ai-fallback.test.js
// Due fornitori in fila: Gemini veloce ("lite", senza ragionamento) e, se non risponde, Claude.
// Qui si verifica quello che conta davvero: non restare mai piantati e non fingere mai un successo.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateStructured,
  openaiGenerate,
  pickOpenAIModel,
  pickOpenAITranscribeModel,
  clearOpenAICache,
  setOpenAIBudget,
  anthropicGenerate,
  pickAnthropicModel,
  partsToAnthropic,
  clearAnthropicCache,
  setGeminiBudget,
} from '../src/services/ai-providers.js';
import { pickGenerateModel, clearModelCache, setGeminiTimeout } from '../src/services/gemini-core.js';

const GEMINI_MODELS = [
  { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
];

const CLAUDE_MODELS = {
  data: [
    { id: 'claude-sonnet-4-5', created_at: '2026-02-01T00:00:00Z' },
    { id: 'claude-haiku-4-5', created_at: '2026-01-01T00:00:00Z' },
    { id: 'claude-haiku-5-5', created_at: '2026-05-01T00:00:00Z' },
  ],
};

const ESTRAZIONE = { finance_transactions: [{ type: 'expense', amount: 45, description: 'Benzina' }] };

/** fetch finto: si decide, per ciascun fornitore, se risponde, se è lento o se dà errore. */
function makeFetch({ gemini = 'ok', anthropic = 'ok', geminiStatus = 503 } = {}) {
  const calls = { geminiList: 0, geminiGenerate: 0, anthropicList: 0, anthropicMessages: 0, bodies: [] };
  const hang = (init) => new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

  const fn = async (url, init = {}) => {
    const u = String(url);

    if (u.includes('generativelanguage.googleapis.com')) {
      if (u.includes('/models?')) {
        calls.geminiList++;
        if (gemini === 'hang_list') return hang(init);
        return { ok: true, json: async () => ({ models: GEMINI_MODELS }) };
      }
      calls.geminiGenerate++;
      calls.bodies.push(JSON.parse(init.body || '{}'));
      if (gemini === 'hang') return hang(init);
      if (gemini === 'error') return { ok: false, status: geminiStatus, text: async () => JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }) };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(ESTRAZIONE) }] } }] }) };
    }

    if (u.includes('api.anthropic.com')) {
      if (u.includes('/models')) {
        calls.anthropicList++;
        return { ok: true, json: async () => CLAUDE_MODELS };
      }
      calls.anthropicMessages++;
      calls.bodies.push(JSON.parse(init.body || '{}'));
      if (anthropic === 'hang') return hang(init);
      if (anthropic === 'error') return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'overloaded' } }) };
      // Claude risponde senza la graffa iniziale, perché gliela diamo noi come inizio forzato
      const text = JSON.stringify(ESTRAZIONE).slice(1);
      return { ok: true, json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) };
    }

    return { ok: false, status: 404, text: async () => 'not found' };
  };
  return { fn, calls };
}

describe('21. Due fornitori in fila: Gemini veloce, Claude di riserva', () => {
  beforeEach(() => {
    clearModelCache();
    clearAnthropicCache();
    clearOpenAICache();
    setOpenAIBudget(10000);
    setGeminiBudget(5000);
    setGeminiTimeout(15000);
  });

  it('1. per estrarre dati sceglie il modello "lite" (meno affollato) e spegne il ragionamento', async () => {
    expect(pickGenerateModel(GEMINI_MODELS, '', { fast: true })).toBe('gemini-flash-lite-latest');
    expect(pickGenerateModel(GEMINI_MODELS)).toBe('gemini-flash-latest'); // la scelta normale resta invariata

    const { fn, calls } = makeFetch();
    const res = await generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: [{ text: 'ho speso 45 euro di benzina' }] });

    expect(res.provider).toBe('gemini');
    expect(res.model).toBe('gemini-flash-lite-latest');
    expect(res.data).toEqual(ESTRAZIONE);
    expect(calls.bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(calls.anthropicMessages).toBe(0); // la riserva non viene disturbata se il primo risponde
  });

  it('2. se Gemini dice "sovraccarico" (il guasto vero visto in produzione) subentra Claude e il dato si salva lo stesso', async () => {
    const { fn, calls } = makeFetch({ gemini: 'error', geminiStatus: 503 });
    const res = await generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: [{ text: 'ho speso 45 euro di benzina' }] });

    expect(res.provider).toBe('anthropic');
    expect(res.data).toEqual(ESTRAZIONE);
    expect(res.fallbackReason).toMatch(/Gemini.*non risponde/i);
    expect(calls.anthropicMessages).toBe(1);
  });

  it('3. se Gemini resta appeso si passa a Claude entro il tetto di tempo, senza aspettare mezzo minuto', async () => {
    setGeminiBudget(300); // nei test non serve aspettare i 5 secondi veri
    const { fn, calls } = makeFetch({ gemini: 'hang' });
    const t0 = Date.now();
    const res = await generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: [{ text: 'ciao' }] });

    expect(res.provider).toBe('anthropic');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(calls.geminiGenerate).toBe(1); // un solo tentativo: con la riserva pronta non si insiste
  });

  it('4. se si blocca anche l\'elenco dei modelli di Gemini, la riserva parte comunque', async () => {
    setGeminiBudget(300);
    const { fn } = makeFetch({ gemini: 'hang_list' });
    const res = await generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: [{ text: 'ciao' }] });
    expect(res.provider).toBe('anthropic');
  });

  it('5. se falliscono ENTRAMBI non si inventa nulla: errore esplicito col motivo', async () => {
    setGeminiBudget(300);
    const { fn } = makeFetch({ gemini: 'error', anthropic: 'error' });
    await expect(generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: [{ text: 'ciao' }] }))
      .rejects.toMatchObject({ code: 'unavailable' });
  });

  it('6. senza nessuna chiave lo dice chiaramente', async () => {
    const { fn } = makeFetch();
    await expect(generateStructured({ geminiKey: '', anthropicKey: '', fetchFn: fn, parts: [{ text: 'ciao' }] }))
      .rejects.toMatchObject({ code: 'not_configured' });
  });

  it('7. con la sola riserva configurata funziona ugualmente (Gemini assente)', async () => {
    const { fn, calls } = makeFetch();
    const res = await generateStructured({ geminiKey: '', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: [{ text: 'ciao' }] });
    expect(res.provider).toBe('anthropic');
    expect(calls.geminiGenerate).toBe(0);
  });

  it('8. le note vocali le gestisce solo Gemini: se non risponde lo dice invece di far finta', async () => {
    setGeminiBudget(300);
    const { fn } = makeFetch({ gemini: 'hang' });
    const vocale = [{ text: 'nota' }, { inline_data: { mime_type: 'audio/ogg', data: 'AAAA' } }];
    await expect(generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: vocale }))
      .rejects.toMatchObject({ code: 'media_unsupported' });
  });

  it('9. le foto invece passano anche a Claude, convertite nel suo formato', async () => {
    const foto = [{ text: 'scontrino' }, { inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } }];
    const blocchi = partsToAnthropic(foto);
    expect(blocchi).toEqual([
      { type: 'text', text: 'scontrino' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } },
    ]);

    setGeminiBudget(300);
    const { fn } = makeFetch({ gemini: 'hang' });
    const res = await generateStructured({ geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant-xxx', fetchFn: fn, parts: foto });
    expect(res.provider).toBe('anthropic');
  });

  it('10. il modello di Claude si sceglie dal suo elenco (il più recente "haiku"), non è scritto nel codice', async () => {
    expect(pickAnthropicModel(CLAUDE_MODELS.data)).toBe('claude-haiku-5-5');
    expect(pickAnthropicModel(CLAUDE_MODELS.data, 'claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
    expect(() => pickAnthropicModel(CLAUDE_MODELS.data, 'claude-inesistente')).toThrow(/non è disponibile/);
    expect(() => pickAnthropicModel([])).toThrow(/Nessun modello/);
  });

  it('11. chiave di Claude sbagliata: messaggio chiaro, non un errore tecnico incomprensibile', async () => {
    const fn = async (url) => (String(url).includes('/models')
      ? { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }) }
      : { ok: false, status: 401, text: async () => '' });
    await expect(anthropicGenerate({ apiKey: 'sk-ant-sbagliata', fetchFn: fn, parts: [{ text: 'x' }] }))
      .rejects.toMatchObject({ code: 'invalid_api_key' });
  });

  // ------------------------------------------------------------------ OpenAI
  const OPENAI_MODELS = { data: [
    { id: 'gpt-5.5' }, { id: 'gpt-5.5-mini' }, { id: 'gpt-5.5-mini-2026-04-01' }, { id: 'gpt-5.4-mini' }, { id: 'gpt-5.5-nano' },
    { id: 'gpt-realtime-mini' }, { id: 'gpt-4o-mini-transcribe' }, { id: 'gpt-4o-transcribe' }, { id: 'gpt-4o-transcribe-diarize' },
    { id: 'whisper-1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-image-2' },
  ] };

  function makeOpenAIFetch({ openai = 'ok', rejectParams = [], gemini = 'ok' } = {}) {
    const calls = { chat: 0, transcriptions: 0, geminiGenerate: 0, bodies: [] };
    const base = makeFetch({ gemini });
    const fn = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('api.openai.com')) {
        if (u.endsWith('/models')) return { ok: true, json: async () => OPENAI_MODELS };
        if (u.includes('/audio/transcriptions')) {
          calls.transcriptions++;
          return { ok: true, json: async () => ({ text: 'ho speso 45 euro di benzina' }) };
        }
        if (u.includes('/chat/completions')) {
          calls.chat++;
          const body = JSON.parse(init.body || '{}');
          calls.bodies.push(body);
          if (openai === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
          if (openai === 'no_credit') return { ok: false, status: 429, text: async () => JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }) };
          if (openai === 'error') return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'server error' } }) };
          for (const param of rejectParams) {
            if (param in body) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: `Unsupported parameter: '${param}' is not supported with this model.` } }) };
          }
          return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(ESTRAZIONE) } }] }) };
        }
      }
      return base.fn(url, init);
    };
    return { fn, calls, base: base.calls };
  }

  it('12. il modello OpenAI si sceglie dal suo elenco: il più recente "mini", senza versioni datate né modelli audio/immagini', () => {
    expect(pickOpenAIModel(OPENAI_MODELS.data)).toBe('gpt-5.5-mini');
    expect(pickOpenAIModel(OPENAI_MODELS.data, 'gpt-5.5')).toBe('gpt-5.5');
    expect(() => pickOpenAIModel(OPENAI_MODELS.data, 'gpt-inesistente')).toThrow(/non è disponibile/);
    expect(pickOpenAITranscribeModel(OPENAI_MODELS.data)).toBe('gpt-4o-mini-transcribe');
    expect(pickOpenAITranscribeModel([{ id: 'whisper-1' }])).toBe('whisper-1');
  });

  it('13. con la chiave OpenAI risponde OpenAI per primo: Gemini e Claude non vengono nemmeno disturbati', async () => {
    const { fn, calls, base } = makeOpenAIFetch();
    const res = await generateStructured({ openaiKey: 'sk-oa', geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant', fetchFn: fn, parts: [{ text: 'ho speso 45 euro di benzina' }] });
    expect(res.provider).toBe('openai');
    expect(res.model).toBe('gpt-5.5-mini');
    expect(res.data).toEqual(ESTRAZIONE);
    expect(calls.chat).toBe(1);
    expect(base.geminiGenerate).toBe(0);
    expect(base.anthropicMessages).toBe(0);
  });

  it('14. se OpenAI non risponde (credito finito, errore, appeso) subentra Gemini e poi Claude, e il motivo è scritto', async () => {
    let t = makeOpenAIFetch({ openai: 'no_credit' });
    let res = await generateStructured({ openaiKey: 'sk-oa', geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant', fetchFn: t.fn, parts: [{ text: 'x' }] });
    expect(res.provider).toBe('gemini');
    expect(res.fallbackReason).toMatch(/credito OpenAI è finito/);

    t = makeOpenAIFetch({ openai: 'error', gemini: 'error' });
    res = await generateStructured({ openaiKey: 'sk-oa', geminiKey: 'AIzaKEY1234', anthropicKey: 'sk-ant', fetchFn: t.fn, parts: [{ text: 'x' }] });
    expect(res.provider).toBe('anthropic');
    expect(res.fallbackReason).toMatch(/OpenAI/);
    expect(res.fallbackReason).toMatch(/Gemini/);

    setOpenAIBudget(300);
    t = makeOpenAIFetch({ openai: 'hang' });
    const t0 = Date.now();
    res = await generateStructured({ openaiKey: 'sk-oa', geminiKey: 'AIzaKEY1234', fetchFn: t.fn, parts: [{ text: 'x' }] });
    expect(res.provider).toBe('gemini');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('15. se falliscono TUTTI l\'errore elenca il motivo di ciascuno (così si capisce cosa sistemare)', async () => {
    setGeminiBudget(300);
    const t = makeOpenAIFetch({ openai: 'no_credit', gemini: 'error' });
    await expect(generateStructured({ openaiKey: 'sk-oa', geminiKey: 'AIzaKEY1234', fetchFn: t.fn, parts: [{ text: 'x' }] }))
      .rejects.toThrow(/OpenAI.*credito.*Gemini/s);
  });

  it('16. modelli diversi accettano parametri diversi: quelli rifiutati vengono tolti da soli e la richiesta riesce comunque', async () => {
    const t = makeOpenAIFetch({ rejectParams: ['reasoning_effort', 'max_completion_tokens'] });
    const res = await generateStructured({ openaiKey: 'sk-oa', fetchFn: t.fn, parts: [{ text: 'ciao' }] });
    expect(res.provider).toBe('openai');
    expect(res.data).toEqual(ESTRAZIONE);
    expect(t.calls.chat).toBeGreaterThan(1); // il primo tentativo è stato rifiutato, poi corretto
    const ultimo = t.calls.bodies.at(-1);
    expect('reasoning_effort' in ultimo).toBe(false);
    expect('max_completion_tokens' in ultimo).toBe(false);
  });

  it('17. i vocali con OpenAI: prima trascritti, poi capiti; le foto passano come immagini', async () => {
    const t = makeOpenAIFetch();
    const vocale = [{ text: 'nota' }, { inline_data: { mime_type: 'audio/ogg', data: 'AAAA' } }];
    const res = await generateStructured({ openaiKey: 'sk-oa', fetchFn: t.fn, parts: vocale });
    expect(res.provider).toBe('openai');
    expect(t.calls.transcriptions).toBe(1);
    expect(JSON.stringify(t.calls.bodies[0].messages)).toContain('ho speso 45 euro di benzina');

    const t2 = makeOpenAIFetch();
    await generateStructured({ openaiKey: 'sk-oa', fetchFn: t2.fn, parts: [{ text: 'scontrino' }, { inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } }] });
    const contenuto = t2.calls.bodies[0].messages.at(-1).content;
    expect(contenuto.find(c => c.type === 'image_url').image_url.url).toBe('data:image/jpeg;base64,BBBB');
  });

  it('18. chiave OpenAI sbagliata: messaggio chiaro', async () => {
    const fn = async (url) => (String(url).endsWith('/models')
      ? { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Incorrect API key provided' } }) }
      : { ok: false, status: 401, text: async () => '' });
    await expect(openaiGenerate({ apiKey: 'sk-sbagliata', fetchFn: fn, parts: [{ text: 'x' }] })).rejects.toMatchObject({ code: 'invalid_api_key' });
  });
});
