// src/modules/brain.js
// Interfaccia Utente "Second Brain" — Architettura Cognitiva Tri-Layer Ibrida
// Livello 1: Archivio Semantico (pgvector) | Livello 2: Fatti Atomici & Evoluzione Temporale (Mem0) | Livello 3: Knowledge Graph Relazionale

import { store } from '../services/store.js';
import {
  BRAIN_DOMAINS,
  NODE_TYPE_META,
  proposeKnowledge,
  commitKnowledge,
  upsertFact,
  updateFact,
  deleteFact,
  invalidateFact,
  updateMemory,
  updateNode,
  deleteNode,
  updateEdge,
  deleteEdge,
  syncClientToBrain,
} from '../services/brain.js';
import { formatDateTime, escapeHtml } from '../utils/formatters.js';
import { icon } from '../utils/icons.js';
import { mountForceGraph3D, mountNeuralOrb3D, attachSpringTiltCards } from '../utils/three-scenes.js';
import { openFormModal } from '../utils/form-modal.js';
import { showToast } from '../utils/toast.js';
import { mountBrainChat } from './brain-chat.js';
import { mountBrainSources } from './brain-sources.js';

const FACT_CATEGORIES = [
  { value: 'rule', label: 'Regola (vale sempre nelle risposte)' },
  { value: 'preference', label: 'Preferenza (vale sempre nelle risposte)' },
  { value: 'status', label: 'Stato' },
  { value: 'metric', label: 'Numero / misura' },
  { value: 'client_info', label: 'Informazione su un cliente' },
];
const DOMAIN_OPTIONS = Object.entries(BRAIN_DOMAINS).map(([value, meta]) => ({ value, label: `${meta.icon} ${meta.label}` }));
const NODE_TYPE_OPTIONS = Object.entries(NODE_TYPE_META).map(([value, meta]) => ({ value, label: `${meta.icon} ${meta.label}` }));

let activeTab = 'ask'; // 'ask' | 'sources' | 'memories' | 'facts' | 'graph'
let activeGraph3DInstance = null;
let activeOrb3DInstance = null;
let selectedDomainCapture = 'work';
let memoryDomainFilter = 'all';
let memoryTagFilter = '';
let memorySearchText = '';
let graphTypeFilter = 'all';
let selectedGraphNodeId = null;
let lastIngestFeedback = null;
let expandedHistoryKey = null; // "subject::fact_key"

export function renderBrain(container, router) {
  // Sincronizza eventuali clienti già presenti nello store al primo caricamento
  const allClients = store.getAll('clients');
  const existingNodes = store.getAll('brain_nodes');
  if (allClients.length > 0 && existingNodes.length === 0) {
    allClients.forEach(c => syncClientToBrain(c));
  }

  // Le "note" sono le memorie scritte a mano; i pezzi dei documenti importati si vedono nella scheda Fonti
  const memories = store.getAll('brain_memories').filter(m => !m.document_id);
  const documents = store.getAll('brain_documents');
  const activeFacts = store.getActiveFacts();
  const allFacts = store.getAll('brain_facts');
  const { nodes, edges } = store.getBrainGraph();

  const tabs = [
    { id: 'ask', label: 'Chiedi', count: null },
    { id: 'sources', label: 'Fonti', count: documents.length },
    { id: 'memories', label: 'Note', count: memories.length },
    { id: 'facts', label: 'Fatti', count: activeFacts.length },
    { id: 'graph', label: 'Mappa', count: nodes.length },
  ];

  container.innerHTML = `
    <details class="ux-guide-callout">
      <summary>
        <span>${icon('info', 14)} Come funziona il Second Brain</span>
      </summary>
      <div class="callout-body">
        <strong>Chiedi</strong>: fai una domanda e rispondo usando solo quello che so di te, mostrando le fonti.
        <strong>Fonti</strong>: i documenti e le vecchie chat che hai importato.
        <strong>Note</strong>: appunti scritti a mano.
        <strong>Fatti</strong>: informazioni e regole stabili su di te (con lo storico di come sono cambiate).
        <strong>Mappa</strong>: i collegamenti tra persone, clienti, strumenti e idee.
      </div>
    </details>

    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;">
      <div class="segmented-tabs">
        ${tabs.map(t => `
          <button type="button" class="segmented-tab-btn brain-tab-btn ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
            ${t.label}${t.count !== null ? ` <span class="badge badge-gray mono" style="padding:0 6px;font-size:10px;">${t.count}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>

    <div id="brain-tab-content">
      ${activeTab === 'ask' ? '<div id="brain-chat-root"></div>' : ''}
      ${activeTab === 'sources' ? '<div id="brain-sources-root"></div>' : ''}
      ${activeTab === 'memories' ? renderIngestCard() + renderMemoriesTab(memories) : ''}
      ${activeTab === 'facts' ? renderFactsTab(activeFacts, allFacts) : ''}
      ${activeTab === 'graph' ? renderGraphTab(nodes, edges) : ''}
    </div>
  `;

  if (activeTab === 'ask') mountBrainChat(container.querySelector('#brain-chat-root'), router);
  if (activeTab === 'sources') mountBrainSources(container.querySelector('#brain-sources-root'), router, () => renderBrain(container, router));

  bindBrainEvents(container, router);
}

/** Scheda "Aggiungi una nota": l'IA legge il testo e propone fatti e collegamenti, che confermi prima di salvare. */
function renderIngestCard() {
  return `
    <div class="card" style="margin-bottom: 18px;">
      <div class="card-header" style="margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div id="brain-neural-orb-canvas" style="width: 44px; height: 44px; border-radius: 10px; background: #09090b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; border: 1px solid rgba(99,102,241,0.3);"></div>
          <div>
            <div class="card-title">Aggiungi una nota</div>
            <div style="font-size: 11.5px; color: var(--text-muted);">Scrivi un appunto: ne ricavo i fatti da ricordare e te li mostro prima di salvare.</div>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
        ${Object.entries(BRAIN_DOMAINS).map(([key, meta]) => `
          <button type="button" class="btn btn-sm brain-domain-pill ${selectedDomainCapture === key ? 'btn-primary' : 'btn-secondary'}" data-domain="${key}" style="font-size: 11px; padding: 4px 10px;">
            ${meta.icon} ${meta.label}
          </button>
        `).join('')}
      </div>

      <form id="brain-ingest-form">
        <div class="form-row" style="margin-bottom: 10px;">
          <div style="flex: 2;">
            <input type="text" id="brain-ingest-title" class="form-input" placeholder="Titolo breve (facoltativo)" />
          </div>
          <div style="flex: 1;">
            <input type="text" id="brain-ingest-tags" class="form-input" placeholder="Etichette, separate da virgola" />
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <textarea id="brain-ingest-text" class="form-textarea" rows="3" required placeholder="Es: 'TechCorp usa Next.js e Supabase, canone 450€/mese.' oppure 'Da oggi obiettivo 2450 kcal al giorno.'"></textarea>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="brain-voice-dictate-btn" class="btn btn-sm btn-secondary">
            ${icon('mic', 13)} <span>Dettatura Vocale</span>
          </button>
          <button type="submit" id="brain-ingest-submit-btn" class="btn btn-ai">
            ${icon('sparkles', 14)} <span>Memorizza</span>
          </button>
        </div>
      </form>

      ${lastIngestFeedback ? renderIngestFeedbackBanner(lastIngestFeedback) : ''}
    </div>
  `;
}

/**
 * Anteprima prima del salvataggio: l'utente vede cosa è stato capito e conferma (o toglie voci) PRIMA che si salvi.
 * Dice sempre quale motore ha lavorato: se l'IA non ha funzionato lo scrive in chiaro.
 */
function openBrainPreview({ args, proposal, onSaved }) {
  const host = document.createElement('div');
  const facts = proposal.facts || [];
  const edges = proposal.edges || [];
  const engineBox = `<div class="notice ok">✅ Letto dall'IA${proposal.model ? ` (${escapeHtml(proposal.model)})` : ''}. Controlla e conferma.</div>`;

  host.innerHTML = `
    <div class="modal-overlay" id="brain-preview-overlay">
      <div class="modal-dialog">
        <div class="modal-header"><div class="modal-title">Cosa ho capito</div>
          <button type="button" class="btn btn-sm btn-secondary" data-bp-close aria-label="Chiudi">✕</button></div>
        <div class="modal-body">
          ${engineBox}
          <p class="muted" style="margin: 10px 0;">Riassunto: <strong>${escapeHtml(proposal.summary || '—')}</strong></p>
          <h4 class="section-h">Fatti da ricordare (${facts.length})</h4>
          ${facts.length === 0 ? '<p class="muted">Nessun fatto trovato. Il testo verrà salvato comunque come nota.</p>' : `
            <ul class="check-list">
              ${facts.map((f, i) => `
                <li><label><input type="checkbox" data-bp-fact="${i}" checked />
                  <span><strong>${escapeHtml(f.subject)}</strong> · ${escapeHtml(f.fact_key)} = <strong>${escapeHtml(f.fact_value)}</strong></span></label></li>`).join('')}
            </ul>`}
          ${edges.length ? `
            <h4 class="section-h">Collegamenti (${edges.length})</h4>
            <ul class="check-list">
              ${edges.map((e, i) => `
                <li><label><input type="checkbox" data-bp-edge="${i}" checked />
                  <span>${escapeHtml(e.source_label || e.source)} → ${escapeHtml(e.relation_type || 'collegato a')} → ${escapeHtml(e.target_label || e.target)}</span></label></li>`).join('')}
            </ul>` : ''}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bp-close>Annulla, non salvare</button>
          <button type="button" class="btn btn-primary" data-bp-save>Salva</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  host.querySelectorAll('[data-bp-close]').forEach(b => b.addEventListener('click', close));
  host.querySelector('[data-bp-save]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Salvo…';
    try {
      const keepF = new Set([...host.querySelectorAll('[data-bp-fact]:checked')].map(el => Number(el.dataset.bpFact)));
      const keepE = new Set([...host.querySelectorAll('[data-bp-edge]:checked')].map(el => Number(el.dataset.bpEdge)));
      const filtered = {
        ...proposal,
        facts: facts.filter((_, i) => keepF.has(i)),
        edges: edges.filter((_, i) => keepE.has(i)),
      };
      const res = await commitKnowledge(args, filtered);
      close();
      onSaved(res);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Salva';
      alert('Salvataggio non riuscito: ' + err.message);
    }
  });
}

function renderIngestFeedbackBanner(fb) {
  return `
    <div style="margin-top: 14px; padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius); font-size: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <strong style="color: #166534;">✓ Salvato${fb.engine === 'local' ? ' (senza IA)' : ''}</strong>
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
    ${Object.keys(groupedBySubject).length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessun fatto salvato. Aggiungi una nota, importa una fonte o salva una regola dalla chat.
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
                  <div class="surface-box">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                      <div>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                          <code style="font-size: 12px; font-weight: 700; color: var(--accent-primary); background: var(--accent-subtle); padding: 2px 6px; border-radius: 5px;">${f.fact_key}</code>
                          <span class="badge badge-gray" style="font-size: 10px;">${f.category}</span>
                        </div>
                        <div style="font-size: 14px; font-weight: 650; color: var(--text-primary); margin-top: 6px;">
                          ${escapeHtml(f.fact_value)}
                        </div>
                        <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 3px;">
                          Attivo dal: ${formatDateTime(f.valid_from || f.created_at)}
                        </div>
                      </div>

                      <div class="row-actions">
                        <button type="button" class="btn btn-sm btn-secondary btn-icon fact-edit-btn" data-id="${f.id}" title="Modifica">✏️</button>
                        <button
                          type="button"
                          class="btn btn-sm ${history.length > 1 ? 'btn-primary' : 'btn-secondary'} fact-history-btn"
                          data-histkey="${histKey}"
                          title="Vedi evoluzione storica nel tempo"
                        >
                          🕒 Storico (${history.length})
                        </button>
                        <button type="button" class="btn btn-sm btn-secondary btn-icon fact-invalidate-btn" data-id="${f.id}" title="Non vale più: lo sposto nello storico">⏸</button>
                        <button type="button" class="btn btn-sm btn-danger btn-icon fact-delete-btn" data-id="${f.id}" title="Elimina del tutto (era sbagliato)">🗑️</button>
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
    <div class="card" style="margin-bottom: 20px; padding: 14px 18px;">
      <div class="filter-toolbar">
        <div class="filter-toolbar-left">
          <input
            type="text"
            id="brain-mem-search"
            class="form-input"
            style="max-width: 260px;"
            placeholder="Cerca nelle note..."
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
        <div class="muted">
          ${filtered.length} note
        </div>
      </div>
    </div>

    ${filtered.length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessuna nota trovata.
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
                    ${m.embedding_source === 'local' || !m.embedding ? '<span class="badge badge-yellow" style="font-size: 10px;" title="Ricerca per significato non attiva su questa nota: ricalcola da Impostazioni → Avanzate">solo parole</span>' : ''}
                    <button type="button" class="btn btn-sm btn-secondary edit-memory-btn" data-id="${m.id}" style="padding: 2px 6px;" title="Modifica">✏️</button>
                    <button type="button" class="btn btn-sm btn-danger delete-memory-btn" data-id="${m.id}" style="padding: 2px 6px;" title="Sposta nel cestino">🗑️</button>
                  </div>
                </div>

                <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px; color: var(--text-main);">
                  ${escapeHtml(m.title || 'Nota')}
                </div>

                <div style="font-size: 13px; color: var(--text-muted); line-height: 1.55; margin-bottom: 12px; white-space: pre-wrap;">${escapeHtml(m.content)}</div>
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
            Nessun nodo nella mappa. Per aggiungerne a mano: Impostazioni → Avanzate.
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
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
              <div class="row-actions">
                <button type="button" class="btn btn-sm btn-secondary graph-node-edit-btn" data-id="${selectedNode.id}" title="Rinomina o cambia tipo">✏️ Modifica</button>
                <button type="button" class="btn btn-sm btn-danger graph-node-delete-btn" data-id="${selectedNode.id}" title="Elimina il nodo e i suoi collegamenti">🗑️ Elimina</button>
              </div>
              <div style="font-size: 11px; color: var(--text-muted);">${directEdges.length} dirette • ${indirectEdges.length} indirette</div>
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
                  <div class="surface-box" style="padding: 8px 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 12.5px;">
                      <strong>[${e.source_label}]</strong>
                      <span class="mono" style="color: var(--accent-primary); font-weight: 700; margin: 0 6px;">──(${e.relation_type})──&gt;</span>
                      <strong>[${e.target_label}]</strong>
                    </div>
                    <div class="row-actions">
                      <span class="badge badge-gray" style="font-size: 10px;">peso: ${e.weight}</span>
                      <button type="button" class="btn btn-sm btn-secondary btn-icon graph-edge-edit-btn" data-id="${e.id}" title="Modifica collegamento">✏️</button>
                      <button type="button" class="btn btn-sm btn-danger btn-icon graph-edge-delete-btn" data-id="${e.id}" title="Elimina collegamento">🗑️</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- Correlazioni Indirette (2-Hop) -->
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--ai-primary); margin-bottom: 8px;">
              🛰️ Correlazioni Indirette Scoperte (2° Hop)
            </div>
            ${indirectEdges.length === 0 ? `
              <div style="font-size: 12px; color: var(--text-muted); font-style: italic;">Nessuna correlazione a 2 hop da questo nodo</div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${indirectEdges.map(e => `
                  <div class="callout-box callout-ai" style="padding: 8px 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 12.5px; color: var(--text-primary);">
                      <strong>[${e.source_label}]</strong>
                      <span class="mono" style="color: var(--ai-primary); font-weight: 700; margin: 0 6px;">──(${e.relation_type})──&gt;</span>
                      <strong>[${e.target_label}]</strong>
                    </div>
                    <div class="row-actions">
                      <span class="badge badge-purple" style="font-size: 10px;">2° Hop</span>
                      <button type="button" class="btn btn-sm btn-secondary btn-icon graph-edge-edit-btn" data-id="${e.id}" title="Modifica collegamento">✏️</button>
                      <button type="button" class="btn btn-sm btn-danger btn-icon graph-edge-delete-btn" data-id="${e.id}" title="Elimina collegamento">🗑️</button>
                    </div>
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
  let orbIdleTimer = null;
  const pulseOrb = () => {
    activeOrb3DInstance?.setEnergy('active');
    if (orbIdleTimer) clearTimeout(orbIdleTimer);
    orbIdleTimer = setTimeout(() => activeOrb3DInstance?.setEnergy('idle'), 1200);
  };
  ingestTxt?.addEventListener('input', pulseOrb);

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
        submitBtn.textContent = '⏳ Leggo il testo…';
      }

      try {
        const args = { title, text, domain: selectedDomainCapture, sourceType: 'manual', tags };
        const proposal = await proposeKnowledge(args);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Memorizza';
        }
        openBrainPreview({
          args,
          proposal,
          onSaved: (res) => {
            lastIngestFeedback = res;
            renderBrain(container, router);
          },
        });
      } catch (err) {
        alert('❌ L\'IA non ha risposto, non ho salvato nulla.\n\n' + err.message + '\n\nIl testo è ancora nella casella. Controlla Impostazioni → Verifica IA.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Memorizza';
        }
      }
    });
  }

  // Chiudi feedback banner
  container.querySelector('#close-ingest-fb-btn')?.addEventListener('click', () => {
    lastIngestFeedback = null;
    renderBrain(container, router);
  });

  // Cambio Tab
  container.querySelectorAll('.brain-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      renderBrain(container, router);
    });
  });

  // --- Fatti: modifica, storico, disattiva, elimina ---
  container.querySelectorAll('.fact-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = store.getById('brain_facts', btn.getAttribute('data-id'));
      if (!f) return;
      openFormModal({
        title: 'Modifica fatto',
        fields: [
          { id: 'subject', label: 'Di chi o di cosa parla', value: f.subject, required: true },
          { id: 'fact_key', label: 'Che cosa (chiave)', value: f.fact_key, required: true, hint: 'Una parola o due, es. target_kcal, tariffa_oraria' },
          { id: 'fact_value', label: 'Valore', value: f.fact_value, required: true },
          { id: 'category', label: 'Tipo', type: 'select', value: f.category, options: FACT_CATEGORIES },
          { id: 'keep_history', label: 'È cambiato davvero: conserva il valore di prima nello storico', type: 'checkbox', value: true, hint: 'Togli la spunta se stai solo correggendo un errore di scrittura.' },
        ],
        submitLabel: 'Salva',
        onSubmit: (v) => {
          const valueChanged = v.fact_value.trim() !== String(f.fact_value).trim();
          const sameIdentity = v.subject.trim().toLowerCase() === String(f.subject).toLowerCase() && v.fact_key.trim().toLowerCase() === String(f.fact_key).toLowerCase();
          if (valueChanged && v.keep_history && sameIdentity) {
            upsertFact({ subject: v.subject, fact_key: v.fact_key, fact_value: v.fact_value, category: v.category });
            expandedHistoryKey = `${v.subject.trim().toLowerCase()}::${f.fact_key.toLowerCase()}`;
          } else {
            updateFact(f.id, v);
          }
          renderBrain(container, router);
        },
      });
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
      if (confirm('Questo fatto non vale più? Resta consultabile nello storico, ma non viene più usato nelle risposte.')) {
        invalidateFact(id);
        renderBrain(container, router);
      }
    });
  });

  container.querySelectorAll('.fact-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Eliminare del tutto questo fatto? Se ne aveva sostituito uno precedente, quello torna attivo.')) return;
      const res = deleteFact(btn.getAttribute('data-id'));
      if (res?.restored) showToast(`Eliminato. È tornato attivo il valore di prima: ${res.restored.fact_value}`, 'info', 5000);
      renderBrain(container, router);
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
  container.querySelectorAll('.edit-memory-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = store.getById('brain_memories', btn.getAttribute('data-id'));
      if (!m) return;
      openFormModal({
        title: 'Modifica nota',
        large: true,
        fields: [
          { id: 'title', label: 'Titolo', value: m.title || '' },
          { id: 'content', label: 'Testo', type: 'textarea', rows: 8, value: m.content || '', required: true },
          { id: 'domain', label: 'Ambito', type: 'select', value: m.domain, options: DOMAIN_OPTIONS },
          { id: 'tags', label: 'Etichette (separate da virgola)', value: (m.tags || []).join(', ') },
        ],
        onSubmit: async (v) => {
          await updateMemory(m.id, v); // se il testo cambia si ricalcola la ricerca per significato
          renderBrain(container, router);
        },
      });
    });
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

  container.querySelector('.graph-node-edit-btn')?.addEventListener('click', (e) => {
    const n = store.getById('brain_nodes', e.currentTarget.getAttribute('data-id'));
    if (!n) return;
    openFormModal({
      title: 'Modifica nodo',
      fields: [
        { id: 'label', label: 'Nome', value: n.label, required: true },
        { id: 'node_type', label: 'Tipo', type: 'select', value: n.node_type, options: NODE_TYPE_OPTIONS },
      ],
      onSubmit: (v) => {
        updateNode(n.id, v);
        renderBrain(container, router);
      },
    });
  });
  container.querySelector('.graph-node-delete-btn')?.addEventListener('click', (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    const n = store.getById('brain_nodes', id);
    if (!n || !confirm(`Eliminare "${n.label}" e tutti i suoi collegamenti?`)) return;
    deleteNode(id);
    selectedGraphNodeId = null;
    renderBrain(container, router);
  });
  container.querySelectorAll('.graph-edge-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const edge = store.getById('brain_edges', btn.getAttribute('data-id'));
      if (!edge) return;
      openFormModal({
        title: 'Modifica collegamento',
        fields: [
          { id: 'relation_type', label: 'Tipo di collegamento', value: edge.relation_type, required: true, hint: 'Es. USA_TECNOLOGIA, LAVORA_CON, CAUSA, MIGLIORA' },
          { id: 'evidence', label: 'Da dove viene (nota)', type: 'textarea', rows: 2, value: edge.evidence || '' },
          { id: 'weight', label: 'Peso', type: 'number', value: edge.weight ?? 1 },
        ],
        onSubmit: (v) => {
          updateEdge(edge.id, v);
          renderBrain(container, router);
        },
      });
    });
  });
  container.querySelectorAll('.graph-edge-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Eliminare questo collegamento?')) return;
      deleteEdge(btn.getAttribute('data-id'));
      renderBrain(container, router);
    });
  });
}
