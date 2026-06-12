// ==UserScript==
// @name         Torn - SED Packer
// @namespace    https://torn.com
// @version      2.1.0
// @description  Favorites panel for quickly selecting a parcel disguise, with SED pinned at top.
// @author       Helmstetter [2272097]
// @match        https://www.torn.com/itemuseparcel.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * ============================================================
 * TERMS OF SERVICE
 * ============================================================
 *
 * | Field              | Details                                      |
 * |--------------------|----------------------------------------------|
 * | Data Storage       | Only locally (localStorage in your browser)  |
 * | Data Sharing       | Nobody - data never leaves your browser      |
 * | Purpose of Use     | QoL when packing SED parcels                 |
 *
 * This script reads the disguise dropdown already on the page and
 * injects a favorites panel to speed up selection. It makes no
 * network requests. Favorites are stored locally in your browser.
 *
 * ============================================================
 */

(function () {
    'use strict';

    const VERSION     = '2.1.0';
    const LOG_PREFIX  = '[Torn:SEDPacker]';
    const STORAGE_KEY = 'torn_sed_packer_favorites';
    const PANEL_ID    = 'sed-packer-panel';
    const SED_LABEL   = 'Small Explosive Device';
    const PREFIX      = 'sep-';
    const MAX_POLLS   = 100; // 100 × 300 ms = 30 s

    // React (old-style) wraps the select's value setter — use the native one.
    const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
    ).set;

    // Currently selected label, for toggle tracking
    let activeLabel = null;

    // ── Storage ──────────────────────────────────────────────────────────────

    function loadFavorites() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function saveFavorites(list) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            console.error(LOG_PREFIX, 'Failed to save favorites:', e);
        }
    }

    // ── Select helpers ───────────────────────────────────────────────────────

    function getDisguiseSelect() {
        for (const sel of document.querySelectorAll('select')) {
            if ([...sel.options].some(o => o.textContent.trim() === SED_LABEL)) return sel;
        }
        return null;
    }

    function getAllItems() {
        const sel = getDisguiseSelect();
        if (!sel) return [];
        return [...sel.options]
            .map(o => o.textContent.trim())
            .filter(t => t && t !== '---');
    }

    function applyDisguise(label) {
        const sel = getDisguiseSelect();
        if (!sel) return false;
        const opt = [...sel.options].find(o => o.textContent.trim() === label);
        if (!opt) return false;
        nativeSetter.call(sel, opt.value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(LOG_PREFIX, `Disguise set to "${label}" (value=${opt.value})`);
        return true;
    }

    function clearDisguise() {
        const sel = getDisguiseSelect();
        if (!sel) return;
        nativeSetter.call(sel, '0'); // '0' is the --- placeholder
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(LOG_PREFIX, 'Disguise cleared');
    }

    // ── Positioning ──────────────────────────────────────────────────────────

    // Position the panel just below the built-in box, left-aligned with it.
    // getBoundingClientRect() returns viewport-relative coords — correct for
    // position:fixed, no scroll offset needed.
    function positionPanel(panel) {
        const anchor = document.querySelector('.items-wrap.view-4')
            || document.querySelector('.items-wrap')
            || (() => {
                const heading = [...document.querySelectorAll('*')].find(
                    e => [...(e.childNodes || [])].some(
                        n => n.nodeType === 3 && n.textContent.includes('Which items would you like')
                    )
                );
                return heading?.parentElement?.parentElement || heading?.parentElement || null;
            })();

        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            panel.style.top    = (rect.bottom + 12) + 'px';
            panel.style.left   = rect.left + 'px';
            panel.style.bottom = 'auto';
            panel.style.right  = 'auto';
        } else {
            panel.style.top    = '80px';
            panel.style.left   = '20px';
            panel.style.bottom = 'auto';
            panel.style.right  = 'auto';
            console.warn(LOG_PREFIX, 'Anchor not found — using fallback position');
        }
    }

    // ── Panel ────────────────────────────────────────────────────────────────

    function buildPanel() {
        const existing = document.getElementById(PANEL_ID);
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = `
            position: fixed;
            z-index: 99999;
            background: #1a1a2e;
            border: 2px solid #4a9eff;
            border-radius: 10px;
            padding: 12px 14px;
            font-family: Arial, sans-serif;
            font-size: 13px;
            color: #e0e0e0;
            box-shadow: 0 4px 20px rgba(74,158,255,0.3);
            min-width: 260px;
            max-width: 320px;
            user-select: none;
        `;

        panel.innerHTML = `
            <div style="font-weight:bold;color:#4a9eff;font-size:14px;margin-bottom:10px;">
                📦 SED Packer
            </div>
            <div id="${PREFIX}rows"></div>
            <div id="${PREFIX}add-area" style="margin-top:8px;">
                <button id="${PREFIX}add-btn" style="
                    width:100%;padding:6px;
                    background:#1a2a4a;border:1px solid #4a9eff;border-radius:6px;
                    color:#a0c8ff;cursor:pointer;font-size:12px;
                ">＋ Add Favorite</button>
                <div id="${PREFIX}search-box" style="display:none;margin-top:6px;">
                    <input id="${PREFIX}search-input" type="text" placeholder="Search items..." style="
                        width:100%;box-sizing:border-box;padding:5px 7px;
                        background:#0d0d1a;border:1px solid #4a9eff;border-radius:5px;
                        color:#e0e0e0;font-size:12px;outline:none;
                    "/>
                    <div id="${PREFIX}search-results" style="
                        max-height:160px;overflow-y:auto;margin-top:4px;
                        background:#0d0d1a;border:1px solid #333;border-radius:5px;
                    "></div>
                </div>
            </div>
            <div style="margin-top:10px;border-top:1px solid #333;padding-top:6px;font-size:10px;color:#555;text-align:center;">
                v${VERSION}
            </div>
        `;

        document.body.appendChild(panel);
        positionPanel(panel);
        renderRows();
        wireAddButton();
    }

    // ── Row rendering ────────────────────────────────────────────────────────

    function renderRows() {
        const container = document.getElementById(`${PREFIX}rows`);
        if (!container) return;
        container.innerHTML = '';
        container.appendChild(makeRow(SED_LABEL, true));
        for (const label of loadFavorites()) {
            container.appendChild(makeRow(label, false));
        }
    }

    function makeRow(label, pinned) {
        const row = document.createElement('div');
        row.dataset.label = label;
        row.style.cssText = `
            display:flex;align-items:center;gap:6px;
            margin-bottom:5px;padding:5px 6px;
            border-radius:6px;border:1px solid #2a2a4a;
            background:#0d0d1a;transition:background 0.15s,border-color 0.15s;
        `;

        const selectBtn = document.createElement('button');
        selectBtn.textContent = '▶';
        selectBtn.title = 'Set disguise to this item';
        selectBtn.style.cssText = `
            flex-shrink:0;padding:3px 7px;
            background:#1a4a7a;border:1px solid #4a9eff;border-radius:4px;
            color:#fff;cursor:pointer;font-size:11px;
        `;
        selectBtn.addEventListener('click', () => onToggleRow(row, label));

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        labelEl.style.cssText = `flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
        if (pinned) labelEl.style.color = '#ffd700';

        row.appendChild(selectBtn);
        row.appendChild(labelEl);

        if (!pinned) {
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '−';
            removeBtn.title = 'Remove from favorites';
            removeBtn.style.cssText = `
                flex-shrink:0;padding:3px 7px;
                background:#3a1a1a;border:1px solid #ff4a4a;border-radius:4px;
                color:#ff4a4a;cursor:pointer;font-size:13px;font-weight:bold;
            `;
            removeBtn.addEventListener('click', () => {
                if (activeLabel === label) {
                    clearDisguise();
                    activeLabel = null;
                }
                saveFavorites(loadFavorites().filter(f => f !== label));
                renderRows();
            });
            row.appendChild(removeBtn);
        }

        // Restore active state if this row was selected before a re-render
        if (activeLabel === label) setRowActive(row, true);

        return row;
    }

    function setRowActive(row, active) {
        row.style.background  = active ? '#0d2b0d' : '#0d0d1a';
        row.style.borderColor = active ? '#4aff4a' : '#2a2a4a';
        const btn = row.querySelector('button');
        if (btn) {
            btn.textContent       = active ? '■' : '▶';
            btn.style.background  = active ? '#0d3a0d' : '#1a4a7a';
            btn.style.borderColor = active ? '#4aff4a' : '#4a9eff';
        }
    }

    function clearAllRows() {
        const container = document.getElementById(`${PREFIX}rows`);
        if (!container) return;
        for (const r of container.querySelectorAll('[data-label]')) {
            setRowActive(r, false);
        }
    }

    function onToggleRow(row, label) {
        if (activeLabel === label) {
            clearDisguise();
            setRowActive(row, false);
            activeLabel = null;
        } else {
            if (!applyDisguise(label)) return;
            clearAllRows();
            setRowActive(row, true);
            activeLabel = label;
        }
    }

    // ── Add favorite search ──────────────────────────────────────────────────

    function wireAddButton() {
        const addBtn      = document.getElementById(`${PREFIX}add-btn`);
        const searchBox   = document.getElementById(`${PREFIX}search-box`);
        const searchInput = document.getElementById(`${PREFIX}search-input`);
        const results     = document.getElementById(`${PREFIX}search-results`);

        addBtn.addEventListener('click', () => {
            const open = searchBox.style.display !== 'none';
            searchBox.style.display = open ? 'none' : 'block';
            if (!open) {
                searchInput.value = '';
                renderSearchResults('', results);
                searchInput.focus();
            }
        });

        searchInput.addEventListener('input', () => {
            renderSearchResults(searchInput.value.trim().toLowerCase(), results);
        });
    }

    function renderSearchResults(query, container) {
        container.innerHTML = '';
        const existing = new Set([SED_LABEL, ...loadFavorites()]);
        const all = getAllItems().filter(l => !existing.has(l));
        const filtered = query ? all.filter(l => l.toLowerCase().includes(query)) : all;

        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding:6px 8px;color:#555;font-size:11px;">No results</div>';
            return;
        }

        for (const label of filtered.slice(0, 80)) {
            const item = document.createElement('div');
            item.textContent = label;
            item.style.cssText = `
                padding:5px 8px;font-size:12px;cursor:pointer;
                border-bottom:1px solid #1a1a2e;color:#e0e0e0;
            `;
            item.addEventListener('mouseenter', () => item.style.background = '#1a2a4a');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('click', () => {
                const favs = loadFavorites();
                if (!favs.includes(label)) {
                    favs.push(label);
                    saveFavorites(favs);
                    renderRows();
                }
                document.getElementById(`${PREFIX}search-box`).style.display = 'none';
            });
            container.appendChild(item);
        }
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init() {
        console.log(LOG_PREFIX, 'Initialized.');

        // Poll until the disguise select appears, then build the panel
        let pollCount = 0;
        function poll() {
            if (getDisguiseSelect()) {
                buildPanel();
                console.log(LOG_PREFIX, 'Panel built.');
                return;
            }
            if (++pollCount < MAX_POLLS) {
                setTimeout(poll, 300);
            } else {
                console.warn(LOG_PREFIX, 'Timed out waiting for disguise dropdown.');
            }
        }

        poll();

        // MutationObserver as a fast-path complement to the poll
        let built = false;
        new MutationObserver(() => {
            if (built) return;
            if (getDisguiseSelect()) {
                built = true;
                buildPanel();
            }
        }).observe(document.body, { childList: true, subtree: true });

        // Reposition on resize — registered once here, not inside buildPanel
        window.addEventListener('resize', () => {
            const panel = document.getElementById(PANEL_ID);
            if (panel) positionPanel(panel);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }

})();
