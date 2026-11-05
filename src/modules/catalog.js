// src/modules/catalog.js
// Catalogo Servizi e Prodotti: Anagrafica, categorie e inserimento rapido nei preventivi

import { store } from '../services/store.js';
import { formatCurrency } from '../utils/formatters.js';

let catalogSearch = '';
let catalogCatFilter = 'all';

export function renderCatalog(container, router) {
  const items = store.getAll('services_catalog');

  const filtered = items.filter(it => {
    if (catalogCatFilter !== 'all' && it.category !== catalogCatFilter) return false;
    if (catalogSearch) {
      const q = catalogSearch.toLowerCase();
      const nMatch = (it.name || '').toLowerCase().includes(q);
      const dMatch = (it.description || '').toLowerCase().includes(q);
      return nMatch || dMatch;
    }
    return true;
  });

  const categories = Array.from(new Set(items.map(it => it.category).filter(Boolean)));

  container.innerHTML = `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1;">
          <input
            type="text"
            id="cat-search-input"
            class="form-input"
            placeholder="Cerca nel catalogo..."
            value="${catalogSearch}"
            style="max-width: 250px;"
          />
          <select id="cat-category-filter" class="form-select" style="max-width: 180px;">
            <option value="all" ${catalogCatFilter === 'all' ? 'selected' : ''}>Tutte le categorie</option>
            ${categories.map(c => `<option value="${c}" ${catalogCatFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>

        <button id="new-catalog-item-btn" class="btn btn-primary">
          + Nuovo Servizio / Prodotto
        </button>
      </div>
    </div>

    ${filtered.length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessun elemento nel catalogo. Aggiungi i tuoi servizi standard per velocizzare la creazione dei preventivi!
      </div>
    ` : `
      <div class="grid-3">
        ${filtered.map(it => `
          <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <span class="badge badge-gray">${it.category || 'Generale'}</span>
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-sm btn-secondary cat-edit-btn" data-id="${it.id}">✏️</button>
                  <button class="btn btn-sm btn-danger cat-trash-btn" data-id="${it.id}">🗑️</button>
                </div>
              </div>

              <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">${it.name}</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--accent); margin-bottom: 8px;">
                ${formatCurrency(it.price)} <span style="font-size: 11px; font-weight: 500; color: var(--text-muted);">/ ${it.unit || 'pz'}</span>
              </div>

              ${it.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">${it.description}</div>` : ''}
              ${it.details ? `<div style="font-size: 11px; color: var(--text-muted); font-style: italic;">${it.details}</div>` : ''}
            </div>

            <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border);">
              <button class="btn btn-sm btn-secondary create-quote-with-item-btn" data-id="${it.id}" style="width: 100%;">
                + Crea Preventivo con questa voce
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `}

    <div id="catalog-modal-container"></div>
  `;

  // Search & Filter
  container.querySelector('#cat-search-input')?.addEventListener('input', (e) => {
    catalogSearch = e.target.value;
    renderCatalog(container, router);
  });
  container.querySelector('#cat-category-filter')?.addEventListener('change', (e) => {
    catalogCatFilter = e.target.value;
    renderCatalog(container, router);
  });

  // Nuovo
  container.querySelector('#new-catalog-item-btn')?.addEventListener('click', () => {
    openCatalogModal(null, container, router);
  });

  // Modifica
  container.querySelectorAll('.cat-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = store.getById('services_catalog', id);
      openCatalogModal(item, container, router);
    });
  });

  // Cestina
  container.querySelectorAll('.cat-trash-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('Spostare questa voce nel cestino?')) {
        store.moveToTrash('services_catalog', id);
        renderCatalog(container, router);
      }
    });
  });

  // Crea preventivo con questa voce
  container.querySelectorAll('.create-quote-with-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = store.getById('services_catalog', id);
      if (item) {
        router.navigate('quotes');
        setTimeout(() => {
          const quotesModule = window._appModules?.quotes;
          if (quotesModule) {
            quotesModule.openQuoteEditorModal({
              items: [{
                description: item.name,
                quantity: 1,
                unit: item.unit || 'pz',
                unit_price: item.price,
                discount_percent: 0,
                is_freebie: false,
                visible_details: item.details || item.description || '',
                images: [],
              }],
            }, document.getElementById('app-main-content'), router);
          }
        }, 50);
      }
    });
  });
}

function openCatalogModal(item, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#catalog-modal-container') || document.body;
  const isEdit = Boolean(item);

  const modalHtml = `
    <div class="modal-overlay" id="catalog-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Modifica Servizio/Prodotto' : 'Nuovo Servizio/Prodotto'}</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-cat-modal-btn">✕</button>
        </div>

        <form id="cat-modal-form">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label class="form-label">Nome Servizio / Articolo *</label>
                <input type="text" id="cat-name" class="form-input" value="${item?.name || ''}" required placeholder="es. Sviluppo Web App SaaS / API Integration" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Categoria</label>
                <input type="text" id="cat-category" class="form-input" list="cat-preset-list" value="${item?.category || 'Sviluppo Software'}" />
                <datalist id="cat-preset-list">
                  <option value="Sviluppo Web & SaaS"></option>
                  <option value="API & Integrazioni Backend"></option>
                  <option value="DevOps & Cloud (Docker/CI-CD)"></option>
                  <option value="Canone Manutenzione & SLA"></option>
                  <option value="Code Audit & Ottimizzazione"></option>
                  <option value="Consulenza Tecnica"></option>
                </datalist>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Prezzo Base (€) *</label>
                <input type="number" id="cat-price" class="form-input" step="0.01" value="${item?.price || ''}" required placeholder="0.00" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Unità di Misura</label>
                <input type="text" id="cat-unit" class="form-input" value="${item?.unit || 'pz'}" placeholder="pz, ore, giorni, a corpo" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Descrizione Sintetica</label>
              <input type="text" id="cat-desc" class="form-input" value="${item?.description || ''}" placeholder="Breve sintesi per il listino" />
            </div>

            <div class="form-group">
              <label class="form-label">Dettagli Predefiniti (da inserire nel preventivo)</label>
              <textarea id="cat-details" class="form-textarea" rows="3" placeholder="Specifiche tecniche dettagliate che appariranno nel PDF...">${item?.details || ''}</textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancel-cat-modal-btn">Annulla</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Aggiungi al Catalogo'}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#catalog-modal-overlay');
  const form = div.querySelector('#cat-modal-form');

  const closeModal = () => div.remove();
  div.querySelector('#close-cat-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-cat-modal-btn').addEventListener('click', closeModal);

  // Safe backdrop click
  let mouseDownOnBackdrop = false;
  overlay.addEventListener('mousedown', (e) => {
    mouseDownOnBackdrop = (e.target === overlay);
  });
  overlay.addEventListener('mouseup', (e) => {
    if (mouseDownOnBackdrop && e.target === overlay) {
      closeModal();
    }
    mouseDownOnBackdrop = false;
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = div.querySelector('#cat-name').value.trim();
    const price = parseFloat(div.querySelector('#cat-price').value);
    if (!name || isNaN(price)) {
      alert('Compila nome e prezzo.');
      return;
    }

    const payload = {
      name,
      category: div.querySelector('#cat-category').value.trim() || 'Generale',
      price,
      unit: div.querySelector('#cat-unit').value.trim() || 'pz',
      description: div.querySelector('#cat-desc').value.trim(),
      details: div.querySelector('#cat-details').value.trim(),
    };

    if (isEdit) {
      store.update('services_catalog', item.id, payload);
    } else {
      store.create('services_catalog', payload);
    }

    closeModal();
    renderCatalog(parentContainer, router);
  });
}
