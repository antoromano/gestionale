// src/modules/trash.js
// Sezione Cestino: Visualizzazione elementi eliminati, ripristino ed eliminazione definitiva

import { store } from '../services/store.js';
import { formatDateTime } from '../utils/formatters.js';

export function renderTrash(container, router) {
  const trashItems = store.getAllTrash();

  const collectionLabels = {
    clients: 'Cliente',
    quotes: 'Preventivo',
    todos: 'To-do',
    appointments: 'Appuntamento / Shooting',
    expenses: 'Spesa',
    services_catalog: 'Servizio Catalogo',
    payments: 'Pagamento',
  };

  container.innerHTML = `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-weight: 700; font-size: 16px;">Cestino (${trashItems.length} elementi)</div>
          <div style="font-size: 12px; color: var(--text-muted);">
            Gli elementi eliminati rimangono qui e possono essere ripristinati in qualsiasi momento.
          </div>
        </div>

        ${trashItems.length > 0 ? `
          <button id="empty-trash-btn" class="btn btn-danger">
            🗑️ Svuota Cestino Definitivamente
          </button>
        ` : ''}
      </div>
    </div>

    ${trashItems.length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Il cestino è vuoto.
      </div>
    ` : `
      <div class="data-table-wrapper card" style="padding: 0;">
        <table class="data-table mobile-cards-table">
          <thead>
            <tr>
              <th>Tipo Elemento</th>
              <th>Descrizione / Titolo</th>
              <th>Data Eliminazione</th>
              <th style="text-align: right;">Azioni</th>
            </tr>
          </thead>
          <tbody>
            ${trashItems.map(item => {
              const typeLabel = collectionLabels[item.collection] || item.collection;
              const title = item.title || item.name || item.description || item.company_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Elemento';

              return `
                <tr>
                  <td data-label="Tipo"><span class="badge badge-gray">${typeLabel}</span></td>
                  <td data-label="Descrizione" style="font-weight: 600;">${title}</td>
                  <td data-label="Eliminato il">${formatDateTime(item.deleted_at)}</td>
                  <td data-label="Azioni" style="text-align: right;">
                    <button class="btn btn-sm btn-primary restore-trash-btn" data-col="${item.collection}" data-id="${item.id}">
                      ↩️ Ripristina
                    </button>
                    <button class="btn btn-sm btn-danger perm-delete-btn" data-col="${item.collection}" data-id="${item.id}">
                      Elimina Definitivamente
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  // Svuota tutto
  container.querySelector('#empty-trash-btn')?.addEventListener('click', () => {
    if (confirm('Sei sicuro di voler eliminare DEFINITIVAMENTE tutti gli elementi nel cestino? Questa operazione non può essere annullata.')) {
      store.emptyTrash();
      renderTrash(container, router);
    }
  });

  // Ripristina singolo
  container.querySelectorAll('.restore-trash-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-col');
      const id = btn.getAttribute('data-id');
      store.restoreFromTrash(col, id);
      renderTrash(container, router);
    });
  });

  // Elimina definitivamente
  container.querySelectorAll('.perm-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.getAttribute('data-col');
      const id = btn.getAttribute('data-id');
      if (confirm('Eliminare definitivamente questo record?')) {
        store.permanentDelete(col, id);
        renderTrash(container, router);
      }
    });
  });
}
