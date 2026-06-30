/* Kate's Movie Vault — client-side app. Data: movies.json. DB: localStorage (+ optional Sheet sync). */
const App = (() => {
  const LS_KEY = 'movievault_db_v1';
  let MOVIES = [];
  let byId = {};
  let db = { actions: {}, syncUrl: '' };   // actions[id] = {seen, rate, why, ts}
  const state = {
    search: '', seen: 'unseen', lenMin: 0, lenMax: 9999,
    categories: new Set(), tags: new Set(), directors: new Set(), cast: new Set(), sources: new Set(),
    sort: 'recommended'
  };
  let whyTargetId = null, whyRate = null, surpriseCurrent = null;

  /* ---------- storage ---------- */
  function load() {
    try { const s = localStorage.getItem(LS_KEY); if (s) db = Object.assign({ actions: {}, syncUrl: '' }, JSON.parse(s)); }
    catch (e) { console.warn('db load failed', e); }
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) {} }
  function act(id) { return db.actions[id] || (db.actions[id] = {}); }

  /* ---------- recommender ----------
     Build a weighted preference profile from liked(+)/disliked(-) movies over
     categories, tags, director, cast. Score unseen movies by summed feature weights. */
  function buildProfile() {
    const w = { categories: {}, tags: {}, director: {}, cast: {} };
    let liked = 0, disliked = 0;
    for (const id in db.actions) {
      const a = db.actions[id]; const m = byId[id]; if (!m || !a.rate) continue;
      const sign = a.rate === 'like' ? 1 : -1;
      if (sign > 0) liked++; else disliked++;
      (m.categories || []).forEach(c => w.categories[c] = (w.categories[c] || 0) + sign * 1.0);
      (m.tags || []).forEach(t => w.tags[t] = (w.tags[t] || 0) + sign * 0.6);
      (m.director || []).forEach(d => w.director[d] = (w.director[d] || 0) + sign * 1.4);
      (m.cast || []).forEach(c => w.cast[c] = (w.cast[c] || 0) + sign * 0.8);
    }
    return { w, hasData: (liked + disliked) > 0, liked, disliked };
  }
  function scoreMovie(m, prof) {
    let s = 0;
    (m.categories || []).forEach(c => s += (prof.w.categories[c] || 0) * 1.0);
    (m.tags || []).forEach(t => s += (prof.w.tags[t] || 0) * 0.6);
    (m.director || []).forEach(d => s += (prof.w.director[d] || 0) * 1.4);
    (m.cast || []).forEach(c => s += (prof.w.cast[c] || 0) * 0.8);
    // gentle nudge by IMDb rating so cold-start / ties feel sensible
    s += ((m.rating || 0) - 7.5) * 0.15;
    return s;
  }

  /* ---------- filtering ---------- */
  function passes(m) {
    const a = db.actions[m.id] || {};
    if (state.seen === 'seen' && !a.seen) return false;
    if (state.seen === 'unseen' && a.seen) return false;
    const rt = m.runtime || 0;
    if (rt < state.lenMin || rt > state.lenMax) return false;
    if (state.categories.size && !(m.categories || []).some(c => state.categories.has(c))) return false;
    if (state.tags.size && !(m.tags || []).some(t => state.tags.has(t))) return false;
    if (state.directors.size && !(m.director || []).some(d => state.directors.has(d))) return false;
    if (state.cast.size && !(m.cast || []).some(c => state.cast.has(c))) return false;
    if (state.sources.size && !(m.sources || []).some(s => state.sources.has(s))) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const hay = (m.title + ' ' + (m.director || []).join(' ') + ' ' + (m.cast || []).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function currentList() {
    const prof = buildProfile();
    let list = MOVIES.filter(passes);
    const dir = 1;
    switch (state.sort) {
      case 'rating': list.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      case 'year_desc': list.sort((a, b) => (b.year || 0) - (a.year || 0)); break;
      case 'year_asc': list.sort((a, b) => (a.year || 0) - (b.year || 0)); break;
      case 'runtime_asc': list.sort((a, b) => (a.runtime || 9999) - (b.runtime || 9999)); break;
      case 'runtime_desc': list.sort((a, b) => (b.runtime || 0) - (a.runtime || 0)); break;
      case 'title': list.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
      case 'random': list = shuffle(list); break;
      case 'recommended':
      default:
        if (prof.hasData) {
          list.forEach(m => m._score = scoreMovie(m, prof));
          list.sort((a, b) => b._score - a._score || (b.rating || 0) - (a.rating || 0));
        } else {
          list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        }
    }
    return { list, prof };
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------- facets ---------- */
  function facetCounts(key) {
    // count over movies passing ALL OTHER filters (so counts stay meaningful)
    const saved = state[key]; state[key] = new Set();
    const sub = MOVIES.filter(passes);
    state[key] = saved;
    const c = {};
    sub.forEach(m => {
      const vals = key === 'directors' ? m.director : key === 'cast' ? m.cast : key === 'sources' ? m.sources : m[key];
      (vals || []).forEach(v => c[v] = (c[v] || 0) + 1);
    });
    return c;
  }

  function renderChips(elId, key, opts = {}) {
    const el = document.getElementById(elId); if (!el) return;
    const counts = facetCounts(key);
    let entries = Object.entries(counts);
    const filterStr = (opts.filterStr || '').toLowerCase();
    if (filterStr) entries = entries.filter(([v]) => v.toLowerCase().includes(filterStr));
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (opts.limit) entries = entries.slice(0, opts.limit);
    const sel = state[key];
    // always show selected ones at top even if filtered out
    const selExtra = [...sel].filter(v => !entries.find(e => e[0] === v)).map(v => [v, counts[v] || 0]);
    entries = [...selExtra, ...entries];
    el.innerHTML = entries.map(([v, n]) =>
      `<button class="chip ${sel.has(v) ? 'on' : ''}" data-key="${key}" data-val="${esc(v)}">${esc(cap(v))} <span class="n">${n}</span></button>`
    ).join('') || '<span class="muted tiny">none</span>';
  }

  function renderFacets() {
    renderChips('catChips', 'categories');
    renderChips('tagChips', 'tags', { filterStr: gv('tagFilter'), limit: 400 });
    renderChips('dirChips', 'directors', { filterStr: gv('dirFilter'), limit: 400 });
    renderChips('castChips', 'cast', { filterStr: gv('castFilter'), limit: 400 });
    renderChips('srcChips', 'sources');
  }

  /* ---------- render grid ---------- */
  function posterHTML(m, cls) {
    if (m.img) return `<img loading="lazy" src="${esc(m.img)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="noimg" style="display:none">${esc(m.title)}</div>`;
    return `<div class="noimg">${esc(m.title)}</div>`;
  }
  function card(m, prof) {
    const a = db.actions[m.id] || {};
    const seen = a.seen ? 'is-seen' : '';
    const rate = a.rate;
    const cats = (m.categories || []).map(c => `<span class="cat-pill">${esc(cap(c))}</span>`).join('');
    const tags = (m.tags || []).slice(0, 6).map(t => `<span class="tag-pill" data-tag="${esc(t)}">${esc(cap(t))}</span>`).join('');
    const dirs = (m.director || []).join(', ');
    const cast = (m.cast || []).slice(0, 3).join(', ');
    const scoreTip = (state.sort === 'recommended' && prof.hasData && m._score) ? `<div class="score-tip ${m._score > 0.3 ? 'has' : ''}">${m._score > 0 ? '▲' : ''}${m._score.toFixed(1)}</div>` : '';
    return `<article class="movie ${seen}" data-id="${m.id}">
      <div class="poster" data-seenmark="SEEN">${posterHTML(m)}${m.rating ? `<div class="rating-badge">★ ${m.rating}</div>` : ''}${scoreTip}</div>
      <div class="body">
        <div class="m-title">${esc(m.title)}</div>
        <div class="m-meta"><span>${m.year || ''}</span>${m.runtime ? `<span>${fmtLen(m.runtime)}</span>` : ''}</div>
        ${cats ? `<div class="m-cats">${cats}</div>` : ''}
        <div class="m-people">${dirs ? `<div>🎬 <b>${esc(dirs)}</b></div>` : ''}${cast ? `<div>★ ${esc(cast)}</div>` : ''}</div>
        ${tags ? `<div class="m-tags">${tags}</div>` : ''}
        <div class="m-actions">
          <button class="act ${a.seen ? 'seen-on' : ''}" data-do="seen" title="Mark watched">${a.seen ? '✓ Seen' : '+ Seen'}</button>
          <button class="act ${rate === 'like' ? 'like-on' : ''}" data-do="like" title="Liked it">👍</button>
          <button class="act ${rate === 'dislike' ? 'dislike-on' : ''}" data-do="dislike" title="Didn't like it">👎</button>
        </div>
      </div>
    </article>`;
  }

  function render() {
    const grid = document.getElementById('grid');
    const { list, prof } = currentList();
    grid.classList.toggle('sorted-recommended', state.sort === 'recommended');
    document.getElementById('empty').hidden = list.length > 0;
    grid.innerHTML = list.map(m => card(m, prof)).join('');
    document.getElementById('resultCount').textContent =
      `${list.length} film${list.length === 1 ? '' : 's'}` +
      (prof.hasData && state.sort === 'recommended' ? `  ·  tuned to ${prof.liked} liked / ${prof.disliked} disliked` : '');
    renderActiveFilters();
    renderFacets();
    const fc = activeFilterCount(), fb = document.getElementById('fbCount');
    if (fb) { fb.hidden = fc === 0; fb.textContent = fc; }
  }

  function renderActiveFilters() {
    const wrap = document.getElementById('activeFilters'); const out = [];
    const add = (label, fn) => out.push(`<span class="af">${esc(label)}<button data-clear='${fn}'>✕</button></span>`);
    state.categories.forEach(v => add(cap(v), `categories|${v}`));
    state.tags.forEach(v => add('#' + cap(v), `tags|${v}`));
    state.directors.forEach(v => add('🎬 ' + v, `directors|${v}`));
    state.cast.forEach(v => add('★ ' + v, `cast|${v}`));
    state.sources.forEach(v => add(v, `sources|${v}`));
    if (state.lenMin !== 0 || state.lenMax !== 9999) add(document.getElementById('lenLabel').textContent, 'len|');
    if (state.seen !== 'all') add(state.seen === 'seen' ? 'Seen' : 'Not seen', 'seen|');
    wrap.innerHTML = out.join('');
  }

  /* ---------- actions ---------- */
  function toggleSeen(id) {
    const a = act(id); const wasSeen = !!a.seen;
    a.seen = !a.seen; a.ts = Date.now();
    save(); sync('seen', id, a); render();
    if (a.seen && !wasSeen) {
      openWhy(id, a.rate || null);   // newly marked seen -> always prompt for a rating
    } else {
      toast(a.seen ? 'Marked as seen' : 'Unmarked');
    }
  }
  function openWhy(id, rate) {
    whyTargetId = id; whyRate = rate;
    const a = db.actions[id] || {};
    whyRate = rate || a.rate || null;
    document.getElementById('whyTitle').textContent = byId[id].title;
    document.getElementById('whyText').value = a.why || '';
    document.querySelectorAll('.why-rate button').forEach(b => b.classList.toggle('sel', b.dataset.rate === whyRate));
    show('whyModal');
  }
  function saveWhy() {
    if (!whyTargetId) return;
    const a = act(whyTargetId);
    a.rate = whyRate; a.why = document.getElementById('whyText').value.trim();
    a.seen = true; a.ts = Date.now();
    save(); sync(whyRate, whyTargetId, a); hide('whyModal'); render();
    toast('Saved. Recommendations updated.');
  }

  /* ---------- optional Google Sheet sync ---------- */
  function sync(action, id, a) {
    if (!db.syncUrl) return;
    const m = byId[id] || {};
    const body = JSON.stringify({
      ts: new Date().toISOString(), id, title: m.title, year: m.year,
      action, seen: !!a.seen, rate: a.rate || '', why: a.why || ''
    });
    try { fetch(db.syncUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body }); }
    catch (e) {}
  }

  /* ---------- surprise ---------- */
  function surprise() {
    const { list } = currentList();
    let pool = list.filter(m => !(db.actions[m.id] && db.actions[m.id].seen));
    if (!pool.length) pool = list;
    if (!pool.length) { toast('No films match the filters'); return; }
    surpriseCurrent = pool[Math.floor(Math.random() * pool.length)];
    const m = surpriseCurrent;
    document.getElementById('surpriseInner').innerHTML =
      (m.img ? `<img class="s-poster" src="${esc(m.img)}" alt="" onerror="this.outerHTML='<div class=\\'s-noimg\\'>${esc(m.title)}</div>'">` : `<div class="s-noimg">${esc(m.title)}</div>`) +
      `<h2>${esc(m.title)}</h2>
       <div class="s-meta">${m.year || ''} · ${m.runtime ? fmtLen(m.runtime) : ''} · ★ ${m.rating || '—'} · ${(m.categories || []).map(cap).join(', ')}</div>
       <div class="s-meta">${(m.director || []).length ? '🎬 ' + esc(m.director.join(', ')) : ''}</div>
       <div class="s-desc">${esc(m.desc || '')}</div>`;
    document.getElementById('surpriseSeenBtn').textContent =
      (db.actions[m.id] && db.actions[m.id].seen) ? 'Seen ✓' : 'Mark as seen';
    show('surpriseModal');
  }

  /* ---------- data modal ---------- */
  function openData() {
    const acts = Object.entries(db.actions);
    const seen = acts.filter(([, a]) => a.seen).length;
    const liked = acts.filter(([, a]) => a.rate === 'like').length;
    const disliked = acts.filter(([, a]) => a.rate === 'dislike').length;
    document.getElementById('dataStats').textContent = `${seen} seen · ${liked} liked · ${disliked} disliked`;
    document.getElementById('syncUrl').value = db.syncUrl || '';
    const rows = acts.filter(([, a]) => a.seen || a.rate).sort((x, y) => (y[1].ts || 0) - (x[1].ts || 0))
      .map(([id, a]) => {
        const m = byId[id] || { title: id };
        const r = a.rate === 'like' ? '👍' : a.rate === 'dislike' ? '👎' : '👁';
        return `<div class="hist-row"><span class="hr-rate">${r}</span><span class="hr-title">${esc(m.title)}</span>${a.why ? `<span class="hr-why">“${esc(a.why)}”</span>` : ''}</div>`;
      }).join('');
    document.getElementById('historyList').innerHTML = rows || '<p class="muted tiny">No history yet. Mark something as seen.</p>';
    show('dataModal');
  }
  function exportJSON() {
    dl('movievault-data.json', JSON.stringify(db, null, 2), 'application/json');
  }
  function exportCSV() {
    const head = 'imdb_id,title,year,seen,rating,why,updated\n';
    const rows = Object.entries(db.actions).filter(([, a]) => a.seen || a.rate).map(([id, a]) => {
      const m = byId[id] || {}; const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
      return [id, q(m.title), m.year || '', a.seen ? 'yes' : 'no', a.rate || '', q(a.why || ''), a.ts ? new Date(a.ts).toISOString() : ''].join(',');
    }).join('\n');
    dl('movievault-data.csv', head + rows, 'text/csv');
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => { try { const o = JSON.parse(r.result); if (o.actions) { db = Object.assign(db, o); save(); render(); openData(); toast('Imported'); } else toast('Not a valid export'); } catch (e) { toast('Import failed'); } };
    r.readAsText(file);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function cap(s) { return String(s).replace(/\b\w/g, c => c.toUpperCase()); }
  function fmtLen(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`; }
  function gv(id) { const e = document.getElementById(id); return e ? e.value : ''; }
  const MODAL_IDS = ['surpriseModal', 'dataModal', 'whyModal'];
  function anyModalOpen() { return MODAL_IDS.some(i => !document.getElementById(i).hidden); }
  function sidebarOpen() { return document.getElementById('sidebar').classList.contains('open'); }
  function updateLock() { document.body.classList.toggle('modal-open', anyModalOpen() || sidebarOpen()); }
  function show(id) {
    MODAL_IDS.forEach(i => { if (i !== id) document.getElementById(i).hidden = true; });
    const el = document.getElementById(id); el.hidden = false; updateLock();
    const f = el.querySelector('.modal-x'); if (f) { try { f.focus(); } catch (e) {} }
  }
  function hide(id) { document.getElementById(id).hidden = true; updateLock(); }
  function closeAllModals() { MODAL_IDS.forEach(i => document.getElementById(i).hidden = true); updateLock(); }
  function openSidebar() { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebarBackdrop').hidden = false; updateLock(); }
  function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarBackdrop').hidden = true; updateLock(); }
  function debounce(fn, ms) { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; }
  function activeFilterCount() {
    return state.categories.size + state.tags.size + state.directors.size + state.cast.size + state.sources.size +
      (state.seen !== 'all' ? 1 : 0) + (state.lenMin !== 0 || state.lenMax !== 9999 ? 1 : 0) + (state.search ? 1 : 0);
  }
  let toastT; function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
  function dl(name, content, type) { const b = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); }

  function clearFilters() {
    state.search = ''; document.getElementById('search').value = '';
    ['categories', 'tags', 'directors', 'cast', 'sources'].forEach(k => state[k].clear());
    state.lenMin = 0; state.lenMax = 9999; state.seen = 'unseen';
    document.querySelectorAll('#lenButtons button').forEach((b, i) => b.classList.toggle('active', i === 0));
    document.querySelectorAll('#seenSeg button').forEach((b) => b.classList.toggle('active', b.dataset.seen === 'unseen'));
    document.getElementById('lenLabel').textContent = 'any';
    render();
  }

  /* ---------- events ---------- */
  function wire() {
    const searchEl = document.getElementById('search');
    searchEl.addEventListener('input', debounce(() => { state.search = searchEl.value.trim(); render(); }, 140));
    document.getElementById('sortSelect').addEventListener('change', e => { state.sort = e.target.value; render(); });
    document.getElementById('clearBtn').addEventListener('click', clearFilters);

    // mobile sidebar
    document.getElementById('mobileFilterBtn').addEventListener('click', openSidebar);
    document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
    document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);
    window.addEventListener('resize', () => { if (window.innerWidth > 820 && sidebarOpen()) closeSidebar(); });

    document.getElementById('seenSeg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      document.querySelectorAll('#seenSeg button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); state.seen = b.dataset.seen; render();
    });
    document.getElementById('lenButtons').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      document.querySelectorAll('#lenButtons button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); state.lenMin = +b.dataset.min; state.lenMax = +b.dataset.max;
      document.getElementById('lenLabel').textContent = b.textContent.trim().toLowerCase() === 'any' ? 'any' : b.textContent.trim();
      render();
    });

    // facet chip clicks (delegated)
    document.querySelector('.sidebar').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (chip) {
        const k = chip.dataset.key, v = chip.dataset.val;
        state[k].has(v) ? state[k].delete(v) : state[k].add(v); render(); return;
      }
      const head = e.target.closest('.facet-head'); if (head) head.parentElement.classList.toggle('collapsed');
    });
    ['tagFilter', 'dirFilter', 'castFilter'].forEach(id => document.getElementById(id).addEventListener('input', debounce(renderFacets, 140)));

    // active filter removal
    document.getElementById('activeFilters').addEventListener('click', e => {
      const b = e.target.closest('button[data-clear]'); if (!b) return;
      const [k, v] = b.dataset.clear.split('|');
      if (k === 'len') { state.lenMin = 0; state.lenMax = 9999; document.querySelectorAll('#lenButtons button').forEach((x, i) => x.classList.toggle('active', i === 0)); document.getElementById('lenLabel').textContent = 'any'; }
      else if (k === 'seen') { state.seen = 'all'; document.querySelectorAll('#seenSeg button').forEach(x => x.classList.toggle('active', x.dataset.seen === 'all')); }
      else state[k].delete(v);
      render();
    });

    // grid actions (delegated)
    document.getElementById('grid').addEventListener('click', e => {
      const tagEl = e.target.closest('.tag-pill');
      if (tagEl) { const t = tagEl.dataset.tag; state.tags.add(t); render(); return; }
      const btn = e.target.closest('.act'); if (!btn) return;
      const id = e.target.closest('.movie').dataset.id; const d = btn.dataset.do;
      if (d === 'seen') toggleSeen(id);
      else openWhy(id, d);
    });

    // surprise
    document.getElementById('surpriseBtn').addEventListener('click', surprise);
    document.getElementById('rerollBtn').addEventListener('click', surprise);
    document.getElementById('surpriseSeenBtn').addEventListener('click', () => {
      if (surpriseCurrent) { toggleSeen(surpriseCurrent.id); document.getElementById('surpriseSeenBtn').textContent = (db.actions[surpriseCurrent.id].seen) ? 'Seen ✓' : 'Mark as seen'; }
    });

    // data modal
    document.getElementById('dataBtn').addEventListener('click', openData);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJSON);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);
    document.getElementById('importFile').addEventListener('change', e => e.target.files[0] && importJSON(e.target.files[0]));
    document.getElementById('syncUrl').addEventListener('change', e => { db.syncUrl = e.target.value.trim(); save(); toast(db.syncUrl ? 'Sync URL saved' : 'Sync disabled'); });

    // why modal
    document.querySelectorAll('.why-rate button').forEach(b => b.addEventListener('click', () => {
      whyRate = b.dataset.rate; document.querySelectorAll('.why-rate button').forEach(x => x.classList.toggle('sel', x === b));
    }));
    document.getElementById('whySave').addEventListener('click', saveWhy);

    // generic modal close
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', e => { e.target.closest('.modal-back').hidden = true; updateLock(); }));
    document.querySelectorAll('.modal-back').forEach(mb => mb.addEventListener('click', e => { if (e.target === mb) { mb.hidden = true; updateLock(); } }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllModals(); closeSidebar(); } });
  }

  async function init() {
    load();
    try {
      const res = await fetch('movies.json'); MOVIES = await res.json();
    } catch (e) { document.getElementById('tagline').textContent = 'Could not load movies.json'; return; }
    MOVIES.forEach(m => byId[m.id] = m);
    document.getElementById('tagline').textContent =
      `${MOVIES.length} films · filter, shuffle, track what you have seen`;
    wire(); render();
  }

  return { init, clearFilters };
})();
document.addEventListener('DOMContentLoaded', App.init);
