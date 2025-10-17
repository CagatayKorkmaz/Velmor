import { supabase } from "./supabase.js";

async function loadRecentPages() {
  const list = document.getElementById("recentPagesList");
  if (!list) return; // page may not include recent list (e.g. page.html)
  list.innerHTML = `<p class="text-gray-400 text-sm">Loading...</p>`;

  // Fetch created_at and updated_at so we can show latest activity
  const { data, error } = await supabase
    .from("pages")
    .select("title, slug, created_at, updated_at")
    .limit(100); // get a reasonable batch then sort client-side to consider updated_at

  if (error) {
    list.innerHTML = `<p class="text-red-400">Hata: ${error.message}</p>`;
    return;
  }

  list.innerHTML = "";

  // sort by latest activity (updated_at if present, otherwise created_at)
  const pages = (data || [])
    .map(p => ({
      ...p,
      latest: new Date(p.updated_at || p.created_at || 0)
    }))
    .sort((a, b) => b.latest - a.latest)
    .slice(0, 5);

  pages.forEach((page) => {
    const container = document.createElement("a");
    container.href = `page.html?slug=${page.slug}`;
    container.className = "block border border-border-dark p-3 hover:bg-white/10 transition";

    const isUpdated = page.updated_at && new Date(page.updated_at) > new Date(page.created_at);
    const labelDate = page.latest.toLocaleDateString();
    const labelText = isUpdated ? `Updated ${labelDate}` : `Added ${labelDate}`;

    container.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-white">${page.title}</span>
        <small class="text-gray-400 ml-3 whitespace-nowrap">${labelText}</small>
      </div>
    `;
    list.appendChild(container);
  });
}

loadRecentPages();

// Recently visited pages (from localStorage)
function loadRecentlyVisited() {
  const list = document.getElementById('recentVisitedList');
  if (!list) return;
  list.innerHTML = '';
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem('recentVisited') || '[]');
  } catch (_) { items = []; }
  if (!items.length) {
    list.innerHTML = `<p class="text-gray-400 text-sm">Henüz ziyaret yok.</p>`;
    return;
  }
  // Sort by visited_at desc and take top 5
  items.sort((a,b) => new Date(b.visited_at||0) - new Date(a.visited_at||0));
  items.slice(0,5).forEach(v => {
    const a = document.createElement('a');
    a.href = `page.html?slug=${v.slug}`;
    a.className = 'block border border-border-dark p-3 hover:bg-white/10 transition';
    const when = v.visited_at ? new Date(v.visited_at).toLocaleDateString() : '';
    a.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-white">${v.title || v.slug}</span>
        <small class="text-gray-400 ml-3 whitespace-nowrap">${when}</small>
      </div>`;
    list.appendChild(a);
  });
}

loadRecentlyVisited();

async function loadAllPages() {
  const container = document.getElementById('allPagesList');
  if (!container) return;
  container.innerHTML = `<p class="text-gray-400 text-sm">Loading...</p>`;

  const { data, error } = await supabase
    .from('pages')
    .select('title, slug')
    .is('parent_id', null)
    .eq('status', 'published')
    .order('title', { ascending: true });

  if (error) {
    container.innerHTML = `<p class="text-red-400">Hata: ${error.message}</p>`;
    return;
  }

  if (!data || !data.length) {
    container.innerHTML = `<p class="text-gray-400 text-sm">Hiç sayfa bulunamadı.</p>`;
    return;
  }

  container.innerHTML = '';
  data.forEach(p => {
    const a = document.createElement('a');
    a.href = `page.html?slug=${p.slug}`;
    a.className = 'border border-white/30 text-white/80 py-1 px-3 text-sm hover:bg-white/20 transition';
    a.textContent = p.title;
    container.appendChild(a);
  });
}

loadAllPages();

// ----- Modal search behavior -----
const openSearchBtn = document.getElementById('openSearch');
const searchModal = document.getElementById('searchModal');
const closeSearchBtn = document.getElementById('closeSearch');
const modalInput = document.getElementById('modalSearchInput');
const resultsContainer = document.getElementById('searchResults');
const searchBackdrop = document.getElementById('searchBackdrop');

function showModal_legacy() {
  if (searchModal) {
    searchModal.style.display = 'flex';
    const panel = searchModal.querySelector('div');
    if (panel) {
      panel.classList.remove('modal-leave-active');
      panel.classList.add('modal-enter');
      requestAnimationFrame(() => {
        panel.classList.add('modal-enter-active');
        panel.classList.remove('modal-enter');
      });
    }
  }
  if (searchBackdrop) searchBackdrop.style.display = 'block';
  modalInput?.focus();
  modalInput && (modalInput.value = '');
  resultsContainer && (resultsContainer.innerHTML = '');
}

function hideModal() {
  if (searchModal) {
    const panel = searchModal.querySelector('div');
    if (panel) {
      panel.classList.remove('modal-enter-active');
      panel.classList.add('modal-leave-active');
      setTimeout(() => {
        searchModal.style.display = 'none';
      }, 180);
    } else {
      searchModal.style.display = 'none';
    }
  }
  if (searchBackdrop) searchBackdrop.style.display = 'none';
}

openSearchBtn?.addEventListener('click', showModal);
closeSearchBtn?.addEventListener('click', hideModal);

// close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideModal();
});

// debounce helper
function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ---- Search helpers ----
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
function highlight(text, query){
  if (!text) return '';
  try {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use gold text, no background
    return escapeHtml(text).replace(new RegExp(`(${esc})`, 'gi'), '<span class="text-gold font-semibold">$1</span>');
  } catch(_) { return escapeHtml(text); }
}

let activeIndex = -1;
function renderResults(items, query){
  resultsContainer.innerHTML = '';
  items.forEach((row, idx) => {
    const a = document.createElement('a');
    a.href = `page.html?slug=${row.slug}`;
    a.className = 'block border-b border-border-dark py-2 text-white hover:text-gold search-item';
    const date = row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '';
    const titleHtml = highlight(row.title || '', query);
    let snippet = row.snippet || row.excerpt || '';
    // If snippet comes with <mark> from ts_headline, neutralize yellow background by styling
    let snippetHtml = snippet
      ? snippet.replace(/<mark>/g, '<span class="text-gold font-semibold">').replace(/<\/mark>/g, '</span>')
      : '';
    if (!snippet.includes('<mark>')) {
      snippetHtml = highlight(snippet, query);
    }
    a.innerHTML = `<div class="flex justify-between"><span class="font-medium">${titleHtml}</span><small class="text-gray-400">${date}</small></div>${snippetHtml ? `<p class="text-sm text-gray-300 mt-1">${snippetHtml}</p>` : ''}`;
    a.dataset.index = String(idx);
    // record click for Recent Searches
    a.addEventListener('click', () => {
      try { saveRecentSearchClick({ title: row.title, slug: row.slug, updated_at: row.updated_at || null }); } catch(_) {}
    });
    resultsContainer.appendChild(a);
  });
  activeIndex = items.length ? 0 : -1;
  updateActiveItem();
}

function updateActiveItem(){
  const nodes = Array.from(resultsContainer.querySelectorAll('.search-item'));
  nodes.forEach((el, i) => {
    if (i === activeIndex) {
      el.classList.add('bg-white/10');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('bg-white/10');
    }
  });
}

async function doSearch(q) {
  if (!q || q.length < 3) {
    resultsContainer.innerHTML = `<p class="text-gray-400">Aramak için en az 3 karakter girin.</p>`;
    return;
  }

  resultsContainer.innerHTML = `<p class="text-gray-400">Aranıyor...</p>`;
  // Try RPC full-text search first
  let rows = null; let rpcError = null;
  try {
    const { data } = await supabase.rpc('search_pages', { q });
    if (Array.isArray(data)) rows = data;
  } catch (e) { rpcError = e; }

  if (rows && rows.length) {
    // rows expected: [{ title, slug, updated_at, snippet }]
    const ql = q.toLowerCase();
    // Prioritize title matches first
    rows.sort((a, b) => {
      const at = (a.title || '').toLowerCase().includes(ql) ? 1 : 0;
      const bt = (b.title || '').toLowerCase().includes(ql) ? 1 : 0;
      if (at !== bt) return bt - at;
      // fallback keep server order
      return 0;
    });
    renderResults(rows.slice(0, 20), q);
    return;
  }

  // Fallback: ilike search (title+content)
  const like = `%${q}%`;
  const { data, error } = await supabase
    .from('pages')
    .select('title, slug, updated_at, content')
    .or(`title.ilike.${like},content.ilike.${like}`)
    .eq('status', 'published')
    .limit(100);

  if (error) {
    resultsContainer.innerHTML = `<p class="text-red-400">Hata: ${error.message}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    resultsContainer.innerHTML = `<p class="text-gray-400">Sonuç bulunamadı.</p>`;
    return;
  }
  const query = q.toLowerCase();
  const scored = (data || []).map(p => {
    let score = 0;
    const title = (p.title || '').toLowerCase();
    const content = (p.content || '').toLowerCase();
    if (title === query) score += 300; // strong exact title match
    const titleIndex = title.indexOf(query);
    if (titleIndex >= 0) score += 220 - Math.max(0, titleIndex); // heavy boost for any title match
    const contentCount = (content.match(new RegExp(query, 'g')) || []).length;
    score += contentCount * 10;
    if (p.updated_at) score += (new Date(p.updated_at).getTime() / (1000 * 60 * 60 * 24)) * 0.001;
    // build excerpt
    let excerpt = '';
    const idx = content.indexOf(query);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      excerpt = (p.content || '').substring(start, Math.min(start + 180, (p.content || '').length)).replace(/<[^>]+>/g, '');
      if (start > 0) excerpt = '...' + excerpt;
      if (idx + q.length < (p.content || '').length) excerpt = excerpt + '...';
    }
    return { title: p.title, slug: p.slug, updated_at: p.updated_at, excerpt, score };
  }).sort((a, b) => b.score - a.score).slice(0, 20).map(({score, ...rest}) => rest);

  renderResults(scored, q);
}

const debouncedSearch = debounce((e) => doSearch(e.target.value), 350);
modalInput?.addEventListener('input', (e) => {
  const val = e.target.value || '';
  const box = ensureRecentContainer();
  if (val.length > 0) {
    if (box) box.innerHTML = '';
  } else {
    // cleared: wipe results and show recent searches
    if (resultsContainer) resultsContainer.innerHTML = '';
    renderRecentSearches();
  }
});
modalInput?.addEventListener('input', debouncedSearch);

// Recent Searches (store last pages clicked from search results)
function readRecentSearchClicks() {
  try { return JSON.parse(localStorage.getItem('recentSearchClicks') || '[]'); } catch(_) { return []; }
}
function writeRecentSearchClicks(arr) {
  try { localStorage.setItem('recentSearchClicks', JSON.stringify(arr.slice(0,3))); } catch(_) {}
}
function saveRecentSearchClick(page) {
  if (!page || !page.slug) return;
  const rec = { title: page.title, slug: page.slug, updated_at: page.updated_at || null, clicked_at: new Date().toISOString() };
  let arr = readRecentSearchClicks();
  arr = Array.isArray(arr) ? arr.filter(p => p && p.slug !== rec.slug) : [];
  arr.unshift(rec);
  writeRecentSearchClicks(arr);
  renderRecentSearches();
}
function ensureRecentContainer() {
  if (!searchModal) return null;
  const panel = searchModal.querySelector('div');
  if (!panel) return null;
  let box = panel.querySelector('#recentSearches');
  if (!box) {
    box = document.createElement('div');
    box.id = 'recentSearches';
    box.className = 'mb-3';
    // insert just above results
    panel.insertBefore(box, resultsContainer);
  }
  return box;
}
function renderRecentSearches() {
  const box = ensureRecentContainer();
  if (!box) return;
  // Use only pages clicked from search results
  let items = readRecentSearchClicks();
  if (!items.length) { box.innerHTML = ''; return; }
  // Already ordered newest first; slice to 3
  box.innerHTML = `<div class="text-sm text-gray-300 mb-1">Recent Searches</div>` +
    `<div class="space-y-2">` + items.slice(0,3).map(p => `
      <a class="block border border-border-dark p-2 hover:bg-white/10 transition" href="page.html?slug=${p.slug}">
        <div class=\"flex justify-between items-center\">
          <span class=\"text-white font-medium\">${p.title || p.slug}</span>
          <small class=\"text-gray-400 ml-3 whitespace-nowrap\">${p.clicked_at ? new Date(p.clicked_at).toLocaleDateString() : ''}</small>
        </div>
      </a>
    `).join('') + `</div>`;
}

// Render recent searches when opening modal
function showModal() {
  if (searchModal) {
    searchModal.style.display = 'flex';
    const panel = searchModal.querySelector('div');
    if (panel) {
      panel.classList.remove('modal-leave-active');
      panel.classList.add('modal-enter');
      requestAnimationFrame(() => {
        panel.classList.add('modal-enter-active');
        panel.classList.remove('modal-enter');
      });
    }
  }
  if (searchBackdrop) searchBackdrop.style.display = 'block';
  modalInput?.focus();
  modalInput && (modalInput.value = '');
  resultsContainer && (resultsContainer.innerHTML = '');
  renderRecentSearches();
}

// Keyboard navigation inside search modal
document.addEventListener('keydown', (e) => {
  if (searchModal?.style.display !== 'flex') return;
  const items = resultsContainer?.querySelectorAll('.search-item') || [];
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActiveItem();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActiveItem();
  } else if (e.key === 'Enter') {
    const el = items[activeIndex];
    if (el) window.location.href = el.getAttribute('href');
  }
});

// Close modal when clicking outside inner box
searchModal?.addEventListener('click', (e) => {
  if (e.target === searchModal) hideModal();
});


// ----- Login modal behavior -----
const openLoginBtn = document.getElementById('openLogin');
const loginModal = document.getElementById('loginModal');
const loginBackdrop = document.getElementById('loginBackdrop');
const closeLoginBtn = document.getElementById('closeLogin');
const loginBtn = document.getElementById('loginBtn');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginRemember = document.getElementById('loginRemember');
const loginError = document.getElementById('loginError');

function showLogin() {
  if (loginModal) loginModal.style.display = 'flex';
  if (loginBackdrop) loginBackdrop.style.display = 'block';
  loginEmail?.focus();
  if (loginError) loginError.textContent = '';
}

function hideLogin() {
  if (loginModal) loginModal.style.display = 'none';
  if (loginBackdrop) loginBackdrop.style.display = 'none';
}

// Default behavior: open the login modal when clicked
openLoginBtn?.addEventListener('click', showLogin);

// On load, detect if user is already signed in and, if so, replace the click handler
// with one that opens admin in a new tab (synchronous, user-initiated) to avoid popup blockers.
// Prepare a named admin handler so we can add/remove it cleanly
const adminHandler = () => window.open('admin.html', '_blank');

function updateAuthUI(user) {
  // remove any existing handlers first
  openLoginBtn?.removeEventListener('click', showLogin);
  openLoginBtn?.removeEventListener('click', adminHandler);

  if (user) {
    // logged-in: clicking opens admin in a new tab
    openLoginBtn?.addEventListener('click', adminHandler);
    // ensure modal is closed if it was open
    hideLogin();
  } else {
    // not logged in: clicking opens login modal
    openLoginBtn?.addEventListener('click', showLogin);
  }
}

// Initial check and setup
(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    updateAuthUI(user);
  } catch (e) {
    console.warn('Auth check failed', e);
    updateAuthUI(null);
  }
})();

// Listen for auth state changes (login/logout in other tabs or here) to update UI immediately
supabase.auth.onAuthStateChange((event, session) => {
  const user = session?.user ?? null;
  updateAuthUI(user);
});

closeLoginBtn?.addEventListener('click', hideLogin);
loginBackdrop?.addEventListener('click', hideLogin);

// Close login modal when clicking outside inner box (match search modal behavior)
loginModal?.addEventListener('click', (e) => {
  if (e.target === loginModal) hideLogin();
});

// close login modal on Escape as well
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideLogin();
});

loginBtn?.addEventListener('click', async () => {
  const adminWin = window.open('', '_blank'); // open blank tab early to avoid popup blockers
  const email = loginEmail?.value?.trim();
  const password = loginPassword?.value?.trim();
  const remember = loginRemember?.checked;

  if (!email || !password) {
    if (loginError) loginError.textContent = 'Lütfen e-posta ve şifre girin.';
    if (adminWin && !adminWin.closed) adminWin.close();
    return;
  }

  loginBtn.disabled = true;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  loginBtn.disabled = false;

  if (error) {
    if (loginError) loginError.textContent = 'Giriş başarısız: ' + error.message;
    if (adminWin && !adminWin.closed) adminWin.close();
    return;
  }

  // If remember is not checked, remove persisted session (Supabase stores session by default)
  if (!remember) {
    try { localStorage.removeItem('supabase.auth.token'); } catch(e){}
  }

  // Navigate the opened tab to admin (fallback to opening a new tab if window was blocked/closed)
  if (adminWin && !adminWin.closed) {
    adminWin.location.href = 'admin.html';
  } else {
    window.open('admin.html', '_blank');
  }
});

// On load, if user is signed in, change login button behavior to redirect
(async () => {
  // no-op: openLoginBtn handler already handles both signed-in and signed-out flows
})();
