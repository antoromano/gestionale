// src/modules/brain.js
// Interfaccia Utente "Second Brain" — Architettura Cognitiva Tri-Layer Ibrida
// Livello 1: Archivio Semantico (pgvector) | Livello 2: Fatti Atomici & Evoluzione Temporale (Mem0) | Livello 3: Knowledge Graph Relazionale

import { store } from '../services/store.js';
import {
  BRAIN_DOMAINS,
  NODE_TYPE_META,
  ingestKnowledge,
  upsertFact,
  invalidateFact,
  upsertGraphRelationship,
  querySecondBrain,
  syncClientToBrain,
} from '../services/brain.js';
import { formatDateTime } from '../utils/formatters.js';
import { icon } from '../utils/icons.js';
import { mountForceGraph3D, mountNeuralOrb3D, attachSpringTiltCards } from '../utils/three-scenes.js';

let activeTab = 'facts'; // 'facts' | 'memories' | 'graph'
let activeGraph3DInstance = null;
let activeOrb3DInstance = null;
let selectedDomainCapture = 'work';
let memoryDomainFilter = 'all';
let memoryTagFilter = '';
let memorySearchText = '';
let graphTypeFilter = 'all';
let selectedGraphNodeId = null;
let lastIngestFeedback = null;
let lastQueryResponse = null;
let expandedHistoryKey = null; // "subject::fact_key"

export function renderBrain(container, router) {
  // Sincronizza eventuali clienti già presenti nello store al primo caricamento
  const allClients = store.getAll('clients');
  const existingNodes = store.getAll('brain_nodes');
  if (allClients.length > 0 && existingNodes.length === 0) {
    allClients.forEach(c => syncClientToBrain(c));
  }

  const memories = store.getAll('brain_memories');
  const activeFacts = store.getActiveFacts();
  const allFacts = store.getAll('brain_facts');
  const { nodes, edges } = store.getBrainGraph();

  container.innerHTML = `
    <!-- GUIDA COLLASSABILE (PROGRESSIVE DISCLOSURE) -->
    <details class="ux-guide-callout">
      <summary>
        <span>${icon('info', 14)} Architettura Cognitiva Tri-Layer Ibrida (Come funziona il Second Brain)</span>
        <span class="badge badge-gray mono">3 Livelli • GraphRAG</span>
      </summary>
      <div class="callout-body">
        Il <strong>Second Brain</strong> opera su 3 livelli sincronizzati su Supabase PostgreSQL:
        <strong>1. Archivio Semantico (pgvector 768-dim)</strong> per appunti e note vettoriali;
        <strong>2. Fatti Atomici (Pattern Mem0)</strong> che aggiornano lo stato corrente mantenendo l'evoluzione storica;
        <strong>3. Knowledge Graph Relazionale (3D Force-Directed + 2-Hop)</strong> per scoprire correlazioni dirette e indirette tra clienti, stack, decisioni e metriche Body.
      </div>
    </details>

    <!-- KPI STATISTICHE TRI-LAYER -->
    <div class="grid-4" style="margin-bottom: 18px;">
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Livello 1 • Memorie Semantiche</div>
        <div class="mono" style="font-size: 24px; font-weight: 700; color: var(--text-main); margin-top: 4px;">${memories.length}</div>
        <div style="font-size: 11px; color: var(--text-muted);">Embedding 768-dim & Tag GIN</div>
      </div>

      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Livello 2 • Fatti Attivi (Mem0)</div>
        <div class="mono" style="font-size: 24px; font-weight: 700; color: var(--success); margin-top: 4px;">${activeFacts.length}</div>
        <div style="font-size: 11px; color: var(--text-muted);"><span class="mono">${allFacts.length - activeFacts.length}</span> versioni storiche archiviate</div>
      </div>

      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Livello 3 • Nodi Knowledge Graph</div>
        <div class="mono" style="font-size: 24px; font-weight: 700; color: #6d28d9; margin-top: 4px;">${nodes.length}</div>
        <div style="font-size: 11px; color: var(--text-muted);">Entità tipizzate in 3D</div>
      </div>

      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">Livello 3 • Relazioni & Archi</div>
        <div class="mono" style="font-size: 24px; font-weight: 700; color: var(--warning); margin-top: 4px;">${edges.length}</div>
        <div style="font-size: 11px; color: var(--text-muted);">Connessioni pesate (2-Hop GraphRAG)</div>
      </div>
    </div>

    <!-- SEZIONE 1 & 2: CATTURA COGNITIVA RAPIDA + INTERROGAZIONE IBRIDA -->
    <div class="grid-2" style="margin-bottom: 18px;">
      <!-- 1. CATTURA COGNITIVA RAPIDA ("Aggiungi al Second Brain") -->
      <div class="card" style="margin-bottom: 0;">
        <div class="card-header" style="margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div id="brain-neural-orb-canvas" title="Nucleo Cognitivo 3D Interattivo (Three.js)" style="width: 44px; height: 44px; border-radius: 10px; background: #09090b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; border: 1px solid rgba(99,102,241,0.3);"></div>
            <div>
              <div class="card-title">Aggiungi al Second Brain</div>
              <div style="font-size: 11.5px; color: var(--text-muted);">Estrae automaticamente Fatti (Mem0) e Relazioni del Grafo</div>
            </div>
          </div>
        </div>

        <!-- Scelta rapida dominio -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
          ${Object.entries(BRAIN_DOMAINS).map(([key, meta]) => `
            <button
              type="button"
              class="btn btn-sm brain-domain-pill ${selectedDomainCapture === key ? 'btn-primary' : 'btn-secondary'}"
              data-domain="${key}"
              style="font-size: 11px; padding: 4px 10px;"
            >
              ${meta.icon} ${meta.label}
            </button>
          `).join('')}
        </div>

        <form id="brain-ingest-form">
          <div class="form-row" style="margin-bottom: 10px;">
            <div style="flex: 2;">
              <input
                type="text"
                id="brain-ingest-title"
                class="form-input"
                placeholder="Titolo breve (opzionale, es. Architettura TechCorp o Allenamento Dorso)"
              />
            </div>
            <div style="flex: 1;">
              <input
                type="text"
                id="brain-ingest-tags"
                class="form-input"
                placeholder="Tag (es. supabase, mrr, pullup)"
              />
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 12px;">
            <textarea
              id="brain-ingest-text"
              class="form-textarea"
              rows="3"
              required
              placeholder="Scrivi o detta un appunto... Es: 'TechCorp usa Next.js e Supabase, canone MRR 450€/mese.' oppure 'Massimale pull-up: 16 ripetizioni, target kcal: 2450 kcal.'"
            ></textarea>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="brain-voice-dictate-btn" class="btn btn-sm btn-secondary">
              ${icon('mic', 13)} <span>Dettatura Vocale</span>
            </button>
            <button type="submit" id="brain-ingest-submit-btn" class="btn btn-ai">
              ${icon('sparkles', 14)} <span>Memorizza & Estrai Conoscenza</span>
            </button>
          </div>
        </form>

        <!-- Feedback immediato estrazione Tri-Layer -->
        ${lastIngestFeedback ? renderIngestFeedbackBanner(lastIngestFeedback) : ''}
      </div>

      <!-- 2. INTERROGAZIONE IBRIDA ("Chiedi al Second Brain") -->
      <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column;">
        <div class="card-header" style="margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${icon('network', 18)}
            <div>
              <div class="card-title">Chiedi al Second Brain (Hybrid GraphRAG)</div>
              <div style="font-size: 11.5px; color: var(--text-muted);">Interroga Memorie Vettoriali, Fatti Attivi Mem0 e Grafo a 2 Hop</div>
            </div>
          </div>
        </div>

        <form id="brain-query-form" style="margin-bottom: 10px;">
          <div style="display: flex; gap: 8px;">
            <input
              type="text"
              id="brain-query-input"
              class="form-input"
              placeholder="Chiedi su clienti, stack, decisioni, metriche body o correlazioni..."
              value="${lastQueryResponse?.query || ''}"
            />
            <button type="submit" class="btn btn-primary">
              ${icon('search', 14)} <span>Chiedi</span>
            </button>
          </div>
        </form>

        <!-- Suggerimenti rapidi di query -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
          <span style="font-size: 11px; color: var(--text-muted); align-self: center;">Query rapide:</span>
          <button type="button" class="btn btn-sm btn-secondary quick-brain-query" data-q="Qual è lo stack e il canone dei clienti?" style="font-size: 11px; padding: 2px 8px;">Stack & MRR Clienti</button>
          <button type="button" class="btn btn-sm btn-secondary quick-brain-query" data-q="Antonio" style="font-size: 11px; padding: 2px 8px;">Stato & Regole Antonio</button>
          <button type="button" class="btn btn-sm btn-secondary quick-brain-query" data-q="Allenamento kcal pull-up" style="font-size: 11px; padding: 2px 8px;">Metriche Body & Salute</button>
        </div>

        <!-- Risultato Interrogazione Ibrida -->
        <div id="brain-query-result-box" style="flex: 1;">
          ${lastQueryResponse ? renderHybridQueryResult(lastQueryResponse) : `
            <div style="background: #fafafa; border: 1px dashed var(--border); border-radius: var(--radius); padding: 22px; text-align: center; color: var(--text-muted); font-size: 12px;">
              Inserisci una domanda per attivare il motore <strong>Hybrid GraphRAG</strong>.<br>
              Risposta sintetizzata con citazioni da <strong>Fatti Mem0</strong>, <strong>Memorie Semantiche</strong> e <strong>Knowledge Graph (1-2 Hop)</strong>.
            </div>
          `}
        </div>
      </div>
    </div>

    <!-- BARRA DI NAVIGAZIONE DELLE 3 TAB (SEGMENTED CONTROL) -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 18px;">
      <div class="segmented-tabs">
        <button
          type="button"
          class="segmented-tab-btn brain-tab-btn ${activeTab === 'facts' ? 'active' : ''}"
          data-tab="facts"
        >
          Fatti Attivi & Evoluzione (Mem0) <span class="badge badge-gray mono" style="padding:0 6px;font-size:10px;">${activeFacts.length}</span>
        </button>
        <button
          type="button"
          class="segmented-tab-btn brain-tab-btn ${activeTab === 'memories' ? 'active' : ''}"
          data-tab="memories"
        >
          Archivio Semantico <span class="badge badge-gray mono" style="padding:0 6px;font-size:10px;">${memories.length}</span>
        </button>
        <button
          type="button"
          class="segmented-tab-btn brain-tab-btn ${activeTab === 'graph' ? 'active' : ''}"
          data-tab="graph"
        >
          ${icon('cube', 13)} Mappa Knowledge Graph 3D <span class="badge badge-gray mono" style="padding:0 6px;font-size:10px;">${nodes.length} nodi • ${edges.length} archi</span>
        </button>
      </div>

      <button type="button" id="brain-sync-clients-btn" class="btn btn-sm btn-secondary" title="Sincronizza tutti i clienti e to-do del Gestionale nel Second Brain">
        Sincronizza dal Gestionale
      </button>
    </div>

    <!-- CONTENUTO DELLA TAB ATTIVA -->
    <div id="brain-tab-content">
      ${activeTab === 'facts' ? renderFactsTab(activeFacts, allFacts) : ''}
      ${activeTab === 'memories' ? renderMemoriesTab(memories) : ''}
      ${activeTab === 'graph' ? renderGraphTab(nodes, edges) : ''}
    </div>
  `;

  bindBrainEvents(container, router);
}

/**
 * Renderizza il banner di feedback immediato dopo l'ingestione
 */
function renderIngestFeedbackBanner(fb) {
  return `
    <div style="margin-top: 14px; padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius); font-size: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="color: #166534;">✓ Conoscenza Acquisita nei 3 Livelli Cognitivi</strong>
        <button type="button" id="close-ingest-fb-btn" style="background: none; border: none; cursor: pointer; color: #166534; font-weight: bold;">✕</button>
      </div>
      <div style="color: #15803d; margin-bottom: 6px;">
        <strong>Memoria #1:</strong> "${fb.memory.title}" (${BRAIN_DOMAINS[fb.memory.domain]?.label || fb.memory.domain})
      </div>
      ${fb.facts.length > 0 ? `
        <div style="margin-bottom: 6px;">
          <strong style="color: #166534;">📌 Fatti Atomici Estratti/Aggiornati (${fb.facts.length}):</strong>
          <div style="display: flex; flex-direction: column; gap: 3px; margin-top: 3px;">
            ${fb.facts.map(f => `
              <div style="background: #ffffff; padding: 4px 8px; border-radius: 4px; border: 1px solid #dcfce7;">
                <strong>[${f.subject}]</strong> <code>${f.fact_key}</code> = <strong>${f.fact_value}</strong>
                ${f.action === 'superseded' && f.previousFact ? `
                  <span class="badge badge-yellow" style="font-size: 10px; margin-left: 6px;">
                    Evoluzione stato: era "${f.previousFact.fact_value}"
                  </span>
                ` : `<span class="badge badge-green" style="font-size: 10px; margin-left: 6px;">${f.action === 'unchanged' ? 'Confermato' : 'Nuovo Fatto'}</span>`}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${fb.edges.length > 0 ? `
        <div>
          <strong style="color: #166534;">🕸️ Relazioni Grafo Aggiunte (${fb.edges.length}):</strong>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px;">
            ${fb.edges.map(e => {
              const src = store.getById('brain_nodes', e.source_node_id);
              const tgt = store.getById('brain_nodes', e.target_node_id);
              return `<span class="badge badge-blue" style="font-size: 10px;">[${src?.label || '?'}] ──(${e.relation_type})──&gt; [${tgt?.label || '?'}]</span>`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Renderizza il risultato dell'interrogazione ibrida (Hybrid GraphRAG)
 */
function renderHybridQueryResult(res) {
  const hasResults = res.activeFacts.length > 0 || res.graphConnections.length > 0 || res.relevantMemories.length > 0;
  return `
    <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 14px;">
      <div style="font-weight: 700; font-size: 13px; color: #1e40af; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
        <span>💡 Risposta Sintetizzata dal Second Brain</span>
        <span class="badge badge-blue">${res.activeFacts.length} Fatti • ${res.graphConnections.length} Archi • ${res.relevantMemories.length} Memorie</span>
      </div>

      ${!hasResults ? `
        <div style="font-size: 12px; color: var(--text-muted);">
          Nessuna corrispondenza trovata per <strong>"${res.query}"</strong>. Aggiungi una nota a sinistra per alimentare il Second Brain!
        </div>
      ` : `
        <div style="font-size: 13px; color: var(--text-main); background: #ffffff; padding: 10px 12px; border-radius: 6px; border-left: 3px solid #7c3aed; margin-bottom: 12px; line-height: 1.55;">
          ${res.aiAnswer ? res.aiAnswer : buildNaturalSynthesisHtml(res)}
        </div>

        <!-- Citazioni esatte dei 3 livelli -->
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
          ${res.activeFacts.length > 0 ? `
            <div>
              <div style="font-weight: 700; color: #166534; margin-bottom: 3px;">📌 Fatti Attivi Citati (Livello 2 - Mem0):</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${res.activeFacts.map(f => `
                  <span class="badge badge-green" style="font-size: 11px;">
                    [${f.subject}] ${f.fact_key}: ${f.fact_value}
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${res.graphConnections.length > 0 ? `
            <div>
              <div style="font-weight: 700; color: #6d28d9; margin-bottom: 3px;">🕸️ Connessioni del Grafo (Livello 3 - fino a 2 Hop):</div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${res.graphConnections.map(c => `
                  <span class="badge" style="background: #ede9fe; color: #5b21b6; font-size: 11px;">
                    [${c.source_label}] ──(${c.relation_type})──&gt; [${c.target_label}] (Hop ${c.hop})
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${res.relevantMemories.length > 0 ? `
            <div>
              <div style="font-weight: 700; color: #1e40af; margin-bottom: 3px;">📚 Memorie Semantiche Usate (Livello 1 - Vettoriale/Lessicale):</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${res.relevantMemories.slice(0, 3).map(m => `
                  <div style="background: #ffffff; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border);">
                    <strong>${m.title}</strong>: ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}
                    <span class="badge badge-gray" style="font-size: 10px; margin-left: 4px;">score: ${m.similarity}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `}
    </div>
  `;
}

function buildNaturalSynthesisHtml(res) {
  const parts = [];
  if (res.activeFacts.length > 0) {
    const bySubj = {};
    res.activeFacts.forEach(f => {
      if (!bySubj[f.subject]) bySubj[f.subject] = [];
      bySubj[f.subject].push(`<strong>${f.fact_key.replace(/_/g, ' ')}</strong>: ${f.fact_value}`);
    });
    const subjStrings = Object.entries(bySubj).map(
      ([subj, list]) => `Per <strong>${subj}</strong> lo stato corrente attesta ${list.join(', ')}.`
    );
    parts.push(subjStrings.join(' '));
  }
  if (res.graphConnections.length > 0) {
    const hop1 = res.graphConnections.filter(c => c.hop === 1);
    const hop2 = res.graphConnections.filter(c => c.hop === 2);
    if (hop1.length > 0) {
      parts.push(
        `Dal Knowledge Graph emergono ${hop1.length} relazioni dirette (${hop1
          .slice(0, 3)
          .map(c => `${c.source_label} → ${c.relation_type} → ${c.target_label}`)
          .join('; ')})` +
          (hop2.length > 0
            ? ` e ${hop2.length} correlazioni indirette a 2-Hop (${hop2
                .slice(0, 2)
                .map(c => `${c.source_label} → ${c.relation_type} → ${c.target_label}`)
                .join('; ')}).`
            : '.')
      );
    }
  }
  if (res.relevantMemories.length > 0 && parts.length === 0) {
    parts.push(`Dall'archivio semantico: "${res.relevantMemories[0].content}"`);
  }
  return parts.join('<br><br>');
}

/**
 * TAB 1: Fatti Attivi & Evoluzione Temporale (Mem0 View)
 */
function renderFactsTab(activeFacts, allFacts) {
  // Raggruppa i fatti attivi per Soggetto
  const groupedBySubject = {};
  activeFacts.forEach(f => {
    const subj = f.subject || 'Generale';
    if (!groupedBySubject[subj]) groupedBySubject[subj] = [];
    groupedBySubject[subj].push(f);
  });

  return `
    <!-- Form rapido aggiunta/aggiornamento manuale Fatto Mem0 -->
    <div class="card" style="margin-bottom: 20px; background: #f8fafc;">
      <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: var(--text-main);">
        ➕ Registra o Aggiorna Fatto Atomico (Logica Mem0 con Storicizzazione Automatica)
      </div>
      <form id="manual-fact-form" class="form-row" style="flex-wrap: wrap; align-items: flex-end;">
        <div style="flex: 1.2; min-width: 150px;">
          <label class="form-label">Soggetto *</label>
          <input type="text" id="mf-subject" class="form-input" required placeholder="es. Antonio, TechCorp, Allenamento" />
        </div>
        <div style="flex: 1.2; min-width: 150px;">
          <label class="form-label">Parametro / Chiave *</label>
          <input type="text" id="mf-key" class="form-input" required placeholder="es. canone_mrr, target_kcal, stack_principale" />
        </div>
        <div style="flex: 1.5; min-width: 180px;">
          <label class="form-label">Valore Attuale *</label>
          <input type="text" id="mf-value" class="form-input" required placeholder="es. 450€/mese, 2400 kcal, Next.js + Supabase" />
        </div>
        <div style="flex: 1; min-width: 130px;">
          <label class="form-label">Categoria</label>
          <select id="mf-category" class="form-select">
            <option value="status">Stato (status)</option>
            <option value="metric">Metrica (metric)</option>
            <option value="client_info">Info Cliente (client_info)</option>
            <option value="preference">Preferenza (preference)</option>
            <option value="rule">Regola (rule)</option>
          </select>
        </div>
        <div>
          <button type="submit" class="btn btn-primary">Salva Stato</button>
        </div>
      </form>
    </div>

    ${Object.keys(groupedBySubject).length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessun fatto atomico attivo nel Second Brain. Aggiungi una nota o usa il modulo qui sopra!
      </div>
    ` : `
      <div class="grid-2">
        ${Object.entries(groupedBySubject).map(([subject, factsList]) => `
          <div class="card" style="margin-bottom: 0;">
            <div class="card-header" style="border-bottom: 1px solid var(--border); padding-bottom: 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">${subject.toLowerCase() === 'antonio' ? '👤' : (subject.toLowerCase() === 'allenamento' ? '🏋️' : '🏢')}</span>
                <div class="card-title">${subject}</div>
              </div>
              <span class="badge badge-green">${factsList.length} fatti attivi</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${factsList.map(f => {
                const history = store.getFactHistory(f.subject, f.fact_key);
                const histKey = `${f.subject.toLowerCase()}::${f.fact_key.toLowerCase()}`;
                const isHistoryOpen = expandedHistoryKey === histKey;

                return `
                  <div style="padding: 10px 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                      <div>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                          <code style="font-size: 12px; font-weight: 700; color: var(--accent); background: #dbeafe; padding: 2px 6px; border-radius: 4px;">${f.fact_key}</code>
                          <span class="badge badge-gray" style="font-size: 10px;">${f.category}</span>
                        </div>
                        <div style="font-size: 14px; font-weight: 700; color: var(--text-main); margin-top: 6px;">
                          ${f.fact_value}
                        </div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 3px;">
                          Attivo dal: ${formatDateTime(f.valid_from || f.created_at)}
                        </div>
                      </div>

                      <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        <button
                          type="button"
                          class="btn btn-sm btn-secondary fact-update-btn"
                          data-subject="${f.subject}"
                          data-key="${f.fact_key}"
                          data-val="${f.fact_value}"
                          data-cat="${f.category}"
                          title="Aggiorna valore (storicizza il valore attuale)"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm ${history.length > 1 ? 'btn-primary' : 'btn-secondary'} fact-history-btn"
                          data-histkey="${histKey}"
                          title="Vedi evoluzione storica nel tempo"
                        >
                          🕒 Storico (${history.length})
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm btn-danger fact-invalidate-btn"
                          data-id="${f.id}"
                          title="Invalida fatto"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    ${isHistoryOpen ? `
                      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border);">
                        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">
                          ⏳ EVOLUZIONE TEMPORALE DELLO STATO (${history.length} versioni):
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                          ${history.map((h, idx) => `
                            <div style="font-size: 11px; padding: 6px 8px; border-radius: 4px; background: ${h.is_active ? '#dcfce7' : '#ffffff'}; border: 1px solid ${h.is_active ? '#86efac' : 'var(--border)'}; display: flex; justify-content: space-between; align-items: center;">
                              <div>
                                <span class="badge ${h.is_active ? 'badge-green' : 'badge-gray'}" style="font-size: 9px; margin-right: 6px;">
                                  ${h.is_active ? 'ATTIVO ORA' : `STORICO v${history.length - idx}`}
                                </span>
                                <strong>${h.fact_value}</strong>
                              </div>
                              <div style="color: var(--text-muted); font-size: 10px;">
                                ${formatDateTime(h.valid_from || h.created_at)}
                                ${h.valid_to ? ` → ${formatDateTime(h.valid_to)}` : ''}
                              </div>
                            </div>
                          `).join('')}
                        </div>
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

/**
 * TAB 2: Archivio Semantico (Memorie & Note)
 */
function renderMemoriesTab(memories) {
  // Estrae tutti i tag unici per filtro rapido
  const allTags = Array.from(
    new Set(memories.flatMap(m => Array.isArray(m.tags) ? m.tags : []))
  );

  const filtered = memories.filter(m => {
    if (memoryDomainFilter !== 'all' && m.domain !== memoryDomainFilter) return false;
    if (memoryTagFilter && (!Array.isArray(m.tags) || !m.tags.includes(memoryTagFilter))) return false;
    if (memorySearchText) {
      const q = memorySearchText.toLowerCase();
      const matchTitle = (m.title || '').toLowerCase().includes(q);
      const matchContent = (m.content || '').toLowerCase().includes(q);
      return matchTitle || matchContent;
    }
    return true;
  });

  return `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap; flex: 1;">
          <input
            type="text"
            id="brain-mem-search"
            class="form-input"
            style="max-width: 260px;"
            placeholder="Cerca nel testo delle memorie..."
            value="${memorySearchText}"
          />
          <select id="brain-mem-domain-filter" class="form-select" style="max-width: 200px;">
            <option value="all" ${memoryDomainFilter === 'all' ? 'selected' : ''}>Tutti i domini</option>
            ${Object.entries(BRAIN_DOMAINS).map(([k, v]) => `
              <option value="${k}" ${memoryDomainFilter === k ? 'selected' : ''}>${v.icon} ${v.label}</option>
            `).join('')}
          </select>
          <select id="brain-mem-tag-filter" class="form-select" style="max-width: 180px;">
            <option value="">Tutti i tag</option>
            ${allTags.map(t => `<option value="${t}" ${memoryTagFilter === t ? 'selected' : ''}>#${t}</option>`).join('')}
          </select>
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          ${filtered.length} memorie visualizzate
        </div>
      </div>
    </div>

    ${filtered.length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessuna memoria semantica trovata con i filtri selezionati.
      </div>
    ` : `
      <div class="grid-3">
        ${filtered.map(m => {
          const domMeta = BRAIN_DOMAINS[m.domain] || BRAIN_DOMAINS.work;
          return `
            <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span class="badge ${domMeta.badge}">${domMeta.icon} ${domMeta.label}</span>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="badge badge-gray" style="font-size: 10px;" title="Embedding vettoriale 768 dimensioni">vec(768)</span>
                    <button type="button" class="btn btn-sm btn-danger delete-memory-btn" data-id="${m.id}" style="padding: 2px 6px;" title="Sposta nel cestino">🗑️</button>
                  </div>
                </div>

                <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px; color: var(--text-main);">
                  ${m.title || 'Nota Second Brain'}
                </div>

                <div style="font-size: 13px; color: var(--text-muted); line-height: 1.55; margin-bottom: 12px; white-space: pre-wrap;">${m.content}</div>
              </div>

              <div>
                ${Array.isArray(m.tags) && m.tags.length > 0 ? `
                  <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;">
                    ${m.tags.map(t => `<span class="badge badge-gray" style="font-size: 10px;">#${t}</span>`).join('')}
                  </div>
                ` : ''}
                <div style="font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border-light); padding-top: 6px; display: flex; justify-content: space-between;">
                  <span>Fonte: ${m.source_type || 'manual'}</span>
                  <span>${formatDateTime(m.created_at)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

/**
 * TAB 3: Mappa Knowledge Graph (Nodi colorati per tipo + Relazioni 1-Hop e 2-Hop + Aggiunta manuale)
 */
function renderGraphTab(nodes, edges) {
  const filteredNodes = nodes.filter(n => graphTypeFilter === 'all' || n.node_type === graphTypeFilter);
  const selectedNode = selectedGraphNodeId ? nodes.find(n => n.id === selectedGraphNodeId) : (filteredNodes[0] || null);

  // Calcola connessioni dirette (1-Hop) e indirette (2-Hop) per il nodo selezionato
  let directEdges = [];
  let indirectEdges = [];
  if (selectedNode) {
    const hop1NeighborIds = new Set();
    directEdges = edges.filter(e => {
      if (e.source_node_id === selectedNode.id) {
        hop1NeighborIds.add(e.target_node_id);
        return true;
      }
      if (e.target_node_id === selectedNode.id) {
        hop1NeighborIds.add(e.source_node_id);
        return true;
      }
      return false;
    });

    const directEdgeIds = new Set(directEdges.map(e => e.id));
    indirectEdges = edges.filter(e => {
      if (directEdgeIds.has(e.id)) return false;
      return hop1NeighborIds.has(e.source_node_id) || hop1NeighborIds.has(e.target_node_id);
    });
  }

  return `
    <!-- SCENA 3D THREE.JS: KNOWLEDGE GRAPH RELAZIONALE 3D FORCE-DIRECTED -->
    <div class="card" style="margin-bottom: 18px; padding: 0; overflow: hidden; background: #09090b; border: 1px solid #27272a;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #27272a; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #818cf8; display: inline-flex;">${icon('cube', 16)}</span>
          <span style="font-weight: 600; font-size: 13px; color: #f4f4f5; letter-spacing: -0.01em;">Mappa Spaziale 3D • Force-Directed Knowledge Graph (Three.js Physics)</span>
          <span class="badge mono" style="background: rgba(99,102,241,0.18); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); font-size: 10px;">Coulomb + Hooke 3D</span>
        </div>
        <div style="font-size: 11px; color: #a1a1aa; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span>Trascina per ruotare • Scroll per zoom • Clicca una sfera 3D per ispezionare</span>
        </div>
      </div>
      <div id="brain-graph-3d-canvas" style="width: 100%; height: 360px; position: relative;"></div>
    </div>

    <!-- Form rapido per aggiungere manualmente una Relazione nel Grafo -->
    <div class="card" style="margin-bottom: 20px; background: #fafafa;">
      <div style="font-weight: 600; font-size: 13px; margin-bottom: 10px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
        ${icon('plus', 14)} <span>Aggiungi Connessione Manuale al Knowledge Graph</span>
      </div>
      <form id="manual-edge-form" class="form-row" style="flex-wrap: wrap; align-items: flex-end;">
        <div style="flex: 1.2; min-width: 140px;">
          <label class="form-label">Nodo Sorgente *</label>
          <input type="text" id="me-source" class="form-input" required placeholder="es. TechCorp o Pull-up" />
        </div>
        <div style="flex: 0.9; min-width: 120px;">
          <label class="form-label">Tipo Sorgente</label>
          <select id="me-source-type" class="form-select">
            ${Object.entries(NODE_TYPE_META).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
          </select>
        </div>
        <div style="flex: 1.1; min-width: 140px;">
          <label class="form-label">Tipo Relazione *</label>
          <select id="me-relation" class="form-select">
            <option value="USA_TECNOLOGIA">USA_TECNOLOGIA</option>
            <option value="LAVORA_CON">LAVORA_CON</option>
            <option value="CAUSA">CAUSA</option>
            <option value="MIGLIORA">MIGLIORA</option>
            <option value="RIDUCE">RIDUCE</option>
            <option value="DIPENDE_DA">DIPENDE_DA</option>
            <option value="CORRELATO_A">CORRELATO_A</option>
          </select>
        </div>
        <div style="flex: 1.2; min-width: 140px;">
          <label class="form-label">Nodo Destinazione *</label>
          <input type="text" id="me-target" class="form-input" required placeholder="es. Supabase o Forza Dorso" />
        </div>
        <div style="flex: 0.9; min-width: 120px;">
          <label class="form-label">Tipo Destinazione</label>
          <select id="me-target-type" class="form-select">
            ${Object.entries(NODE_TYPE_META).map(([k, v]) => `<option value="${k}" ${k === 'technology' ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <button type="submit" class="btn btn-primary">+ Collega Nodi</button>
        </div>
      </form>
    </div>

    <div class="grid-2">
      <!-- Colonna Sinistra: Mappa Nodi Colorati per Tipo -->
      <div class="card" style="margin-bottom: 0;">
        <div class="card-header">
          <div class="card-title">🟢 Nodi del Grafo (${filteredNodes.length})</div>
          <select id="brain-graph-type-filter" class="form-select" style="max-width: 180px;">
            <option value="all" ${graphTypeFilter === 'all' ? 'selected' : ''}>Tutti i tipi</option>
            ${Object.entries(NODE_TYPE_META).map(([k, v]) => `
              <option value="${k}" ${graphTypeFilter === k ? 'selected' : ''}>${v.icon} ${v.label}</option>
            `).join('')}
          </select>
        </div>

        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">
          Clicca su un nodo per esplorare tutte le sue relazioni dirette (1° Hop) e indirette (2° Hop).
        </div>

        ${filteredNodes.length === 0 ? `
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            Nessun nodo presente nel grafo.
          </div>
        ` : `
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${filteredNodes.map(n => {
              const meta = NODE_TYPE_META[n.node_type] || NODE_TYPE_META.concept;
              const isSelected = selectedNode && selectedNode.id === n.id;
              const connCount = edges.filter(e => e.source_node_id === n.id || e.target_node_id === n.id).length;

              return `
                <button
                  type="button"
                  class="graph-node-chip"
                  data-id="${n.id}"
                  style="
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 12px;
                    border-radius: 9999px;
                    background: ${meta.bg};
                    color: ${meta.color};
                    border: 2px solid ${isSelected ? meta.color : 'transparent'};
                    font-weight: 700;
                    font-size: 12px;
                    cursor: pointer;
                    box-shadow: ${isSelected ? '0 0 0 3px rgba(37,99,235,0.2)' : 'none'};
                  "
                >
                  <span>${meta.icon}</span>
                  <span>${n.label}</span>
                  <span style="font-size: 10px; opacity: 0.75;">(${connCount})</span>
                </button>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <!-- Colonna Destra: Ispettore Relazioni del Nodo Selezionato (1-Hop & 2-Hop) -->
      <div class="card" style="margin-bottom: 0;">
        ${!selectedNode ? `
          <div style="text-align: center; padding: 40px; color: var(--text-muted);">
            Seleziona un nodo a sinistra per visualizzare la rete di relazioni.
          </div>
        ` : `
          <div class="card-header" style="border-bottom: 1px solid var(--border); padding-bottom: 10px;">
            <div>
              <span class="badge" style="background: ${(NODE_TYPE_META[selectedNode.node_type] || NODE_TYPE_META.concept).bg}; color: ${(NODE_TYPE_META[selectedNode.node_type] || NODE_TYPE_META.concept).color};">
                ${(NODE_TYPE_META[selectedNode.node_type] || NODE_TYPE_META.concept).icon} ${(NODE_TYPE_META[selectedNode.node_type] || NODE_TYPE_META.concept).label}
              </span>
              <div class="card-title" style="font-size: 18px; margin-top: 4px;">${selectedNode.label}</div>
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
              ${directEdges.length} dirette • ${indirectEdges.length} indirette
            </div>
          </div>

          <!-- Relazioni Dirette (1-Hop) -->
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 8px;">
              🔗 Connessioni Dirette (1° Hop)
            </div>
            ${directEdges.length === 0 ? `
              <div style="font-size: 12px; color: var(--text-muted); font-style: italic;">Nessuna connessione diretta</div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${directEdges.map(e => `
                  <div style="padding: 8px 10px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 12px;">
                      <strong>[${e.source_label}]</strong>
                      <span style="color: var(--accent); font-family: monospace; font-weight: 700; margin: 0 6px;">──(${e.relation_type})──&gt;</span>
                      <strong>[${e.target_label}]</strong>
                    </div>
                    <span class="badge badge-gray" style="font-size: 10px;">peso: ${e.weight}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- Correlazioni Indirette (2-Hop) -->
          <div>
            <div style="font-size: 12px; font-weight: 700; color: #6d28d9; margin-bottom: 8px;">
              🛰️ Correlazioni Indirette Scoperte (2° Hop)
            </div>
            ${indirectEdges.length === 0 ? `
              <div style="font-size: 12px; color: var(--text-muted); font-style: italic;">Nessuna correlazione a 2 hop da questo nodo</div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${indirectEdges.map(e => `
                  <div style="padding: 8px 10px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 12px;">
                      <strong>[${e.source_label}]</strong>
                      <span style="color: #7c3aed; font-family: monospace; font-weight: 700; margin: 0 6px;">──(${e.relation_type})──&gt;</span>
                      <strong>[${e.target_label}]</strong>
                    </div>
                    <span class="badge" style="background: #ede9fe; color: #5b21b6; font-size: 10px;">2° Hop</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        `}
      </div>
    </div>
  `;
}

function bindBrainEvents(container, router) {
  attachSpringTiltCards(container);

  // Monta il Nucleo Cognitivo 3D (Neural Orb) nell'header Second Brain
  if (activeOrb3DInstance?.destroy) {
    activeOrb3DInstance.destroy();
    activeOrb3DInstance = null;
  }
  const orbCanvasEl = container.querySelector('#brain-neural-orb-canvas');
  if (orbCanvasEl) {
    activeOrb3DInstance = mountNeuralOrb3D(orbCanvasEl, { size: 44, initialState: 'idle' });
  }

  // Reattività fisica del Nucleo 3D quando l'utente digita
  const ingestTxt = container.querySelector('#brain-ingest-text');
  const queryTxt = container.querySelector('#brain-query-input');
  let orbIdleTimer = null;
  const pulseOrb = () => {
    activeOrb3DInstance?.setEnergy('active');
    if (orbIdleTimer) clearTimeout(orbIdleTimer);
    orbIdleTimer = setTimeout(() => activeOrb3DInstance?.setEnergy('idle'), 1200);
  };
  ingestTxt?.addEventListener('input', pulseOrb);
  queryTxt?.addEventListener('input', pulseOrb);

  // Monta il Knowledge Graph 3D Force-Directed quando il Tab 3 è attivo
  if (activeGraph3DInstance?.destroy) {
    activeGraph3DInstance.destroy();
    activeGraph3DInstance = null;
  }
  const graph3DCanvas = container.querySelector('#brain-graph-3d-canvas');
  if (graph3DCanvas && activeTab === 'graph') {
    const { nodes, edges } = store.getBrainGraph();
    const filteredNodes = nodes.filter(n => graphTypeFilter === 'all' || n.node_type === graphTypeFilter);
    const activeSel = selectedGraphNodeId || (filteredNodes[0]?.id ?? null);
    activeGraph3DInstance = mountForceGraph3D(graph3DCanvas, {
      nodes: filteredNodes,
      edges,
      selectedNodeId: activeSel,
      onSelectNode: (clickedId) => {
        selectedGraphNodeId = clickedId;
        renderBrain(container, router);
      },
    });
  }

  // Scelta rapida dominio cattura
  container.querySelectorAll('.brain-domain-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDomainCapture = btn.getAttribute('data-domain');
      renderBrain(container, router);
    });
  });

  // Dettatura vocale Web Speech API
  const voiceBtn = container.querySelector('#brain-voice-dictate-btn');
  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert('Il tuo browser non supporta la dettatura vocale diretta. Puoi scrivere nella casella di testo.');
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'it-IT';
      recognition.interimResults = false;
      voiceBtn.textContent = '🔴 In ascolto...';
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const txtEl = container.querySelector('#brain-ingest-text');
        if (txtEl) {
          txtEl.value = (txtEl.value ? txtEl.value + ' ' : '') + transcript;
        }
      };
      recognition.onend = () => {
        voiceBtn.textContent = '🎙️ Dettatura Vocale';
      };
      recognition.start();
    });
  }

  // Submit Cattura Cognitiva Rapida
  const ingestForm = container.querySelector('#brain-ingest-form');
  if (ingestForm) {
    ingestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = container.querySelector('#brain-ingest-title')?.value.trim() || '';
      const text = container.querySelector('#brain-ingest-text')?.value.trim() || '';
      const tagsRaw = container.querySelector('#brain-ingest-tags')?.value || '';
      const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

      if (!text) return;

      const submitBtn = container.querySelector('#brain-ingest-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Elaborazione Tri-Layer...';
      }

      try {
        const res = await ingestKnowledge({
          title,
          text,
          domain: selectedDomainCapture,
          sourceType: 'manual',
          tags,
        });
        lastIngestFeedback = res;
        renderBrain(container, router);
      } catch (err) {
        alert('Errore durante il salvataggio nel Second Brain: ' + err.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '⚡ Memorizza & Estrai Conoscenza';
        }
      }
    });
  }

  // Chiudi feedback banner
  container.querySelector('#close-ingest-fb-btn')?.addEventListener('click', () => {
    lastIngestFeedback = null;
    renderBrain(container, router);
  });

  // Interrogazione Ibrida Second Brain
  const queryForm = container.querySelector('#brain-query-form');
  if (queryForm) {
    queryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = container.querySelector('#brain-query-input')?.value.trim() || '';
      lastQueryResponse = await querySecondBrain(q);
      renderBrain(container, router);
    });
  }

  // Quick query chips
  container.querySelectorAll('.quick-brain-query').forEach(btn => {
    btn.addEventListener('click', async () => {
      const q = btn.getAttribute('data-q');
      lastQueryResponse = await querySecondBrain(q);
      renderBrain(container, router);
    });
  });

  // Cambio Tab
  container.querySelectorAll('.brain-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      renderBrain(container, router);
    });
  });

  // Sincronizza dal Gestionale
  container.querySelector('#brain-sync-clients-btn')?.addEventListener('click', () => {
    const clients = store.getAll('clients');
    clients.forEach(c => syncClientToBrain(c));
    renderBrain(container, router);
  });

  // --- Eventi Tab 1: Fatti Mem0 ---
  const manualFactForm = container.querySelector('#manual-fact-form');
  if (manualFactForm) {
    manualFactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const subject = container.querySelector('#mf-subject').value.trim();
      const fact_key = container.querySelector('#mf-key').value.trim();
      const fact_value = container.querySelector('#mf-value').value.trim();
      const category = container.querySelector('#mf-category').value;

      upsertFact({ subject, fact_key, fact_value, category });
      renderBrain(container, router);
    });
  }

  container.querySelectorAll('.fact-update-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subject = btn.getAttribute('data-subject');
      const fact_key = btn.getAttribute('data-key');
      const currentVal = btn.getAttribute('data-val');
      const category = btn.getAttribute('data-cat');

      const newVal = prompt(`Aggiorna valore per [${subject}] "${fact_key}"\n(Il valore precedente "${currentVal}" verrà conservato nello storico):`, currentVal);
      if (newVal !== null && newVal.trim() !== '') {
        upsertFact({ subject, fact_key, fact_value: newVal.trim(), category });
        expandedHistoryKey = `${subject.toLowerCase()}::${fact_key.toLowerCase()}`;
        renderBrain(container, router);
      }
    });
  });

  container.querySelectorAll('.fact-history-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-histkey');
      expandedHistoryKey = expandedHistoryKey === key ? null : key;
      renderBrain(container, router);
    });
  });

  container.querySelectorAll('.fact-invalidate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('Vuoi invalidare questo fatto attivo? Rimarrà consultabile nello storico.')) {
        invalidateFact(id);
        renderBrain(container, router);
      }
    });
  });

  // --- Eventi Tab 2: Archivio Memorie ---
  container.querySelector('#brain-mem-search')?.addEventListener('input', (e) => {
    memorySearchText = e.target.value;
    renderBrain(container, router);
  });
  container.querySelector('#brain-mem-domain-filter')?.addEventListener('change', (e) => {
    memoryDomainFilter = e.target.value;
    renderBrain(container, router);
  });
  container.querySelector('#brain-mem-tag-filter')?.addEventListener('change', (e) => {
    memoryTagFilter = e.target.value;
    renderBrain(container, router);
  });
  container.querySelectorAll('.delete-memory-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      store.moveToTrash('brain_memories', id);
      renderBrain(container, router);
    });
  });

  // --- Eventi Tab 3: Knowledge Graph ---
  container.querySelector('#brain-graph-type-filter')?.addEventListener('change', (e) => {
    graphTypeFilter = e.target.value;
    selectedGraphNodeId = null;
    renderBrain(container, router);
  });

  container.querySelectorAll('.graph-node-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedGraphNodeId = chip.getAttribute('data-id');
      renderBrain(container, router);
    });
  });

  const manualEdgeForm = container.querySelector('#manual-edge-form');
  if (manualEdgeForm) {
    manualEdgeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const source = container.querySelector('#me-source').value.trim();
      const source_type = container.querySelector('#me-source-type').value;
      const relation_type = container.querySelector('#me-relation').value;
      const target = container.querySelector('#me-target').value.trim();
      const target_type = container.querySelector('#me-target-type').value;

      const res = upsertGraphRelationship({
        source,
        source_type,
        target,
        target_type,
        relation_type,
        evidence: 'Aggiunto manualmente nella mappa Knowledge Graph',
      });
      if (res?.sourceNode) {
        selectedGraphNodeId = res.sourceNode.id;
      }
      renderBrain(container, router);
    });
  }
}

