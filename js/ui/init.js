import { CATEGORIES, POINTS, getBadgeLabel } from '../constants.js';

export function populateCategorySelect(selectId, includeAll = false) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = includeAll
        ? '<option value="">All Categories</option>'
        : '';

    CATEGORIES.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
}

export function renderPointsInfoGrid() {
    const grid = document.getElementById('pointsInfoGrid');
    if (!grid) return;

    grid.innerHTML = [
        { value: POINTS.lost, label: 'Report Lost Item' },
        { value: POINTS.found, label: 'Report Found Item' },
        { value: POINTS.resolved, label: 'Item Returned' },
        { value: POINTS.sightingHelpful, label: 'Verified Helpful Tip' },
        { value: POINTS.sightingRecovered, label: 'Helped Recover Item' }
    ].map(p => `
        <div class="points-card">
            <div class="points-value">+${p.value}</div>
            <p>${p.label}</p>
        </div>
    `).join('');
}

export function showLoading(containerId, message = 'Loading...') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="loading-state"><span class="loading-spinner"></span><p>${message}</p></div>`;
}

export function showEmpty(containerId, message) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="empty-state"><p>${message}</p></div>`;
}

export { getBadgeLabel };
