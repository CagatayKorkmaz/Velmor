import { supabase } from './supabase.js';

// Per-session in-memory cache for pages by slug
const pageCache = Object.create(null);

// Helper: unescape ONLY escaped anchor tags so admins can type raw <a href="...">text</a>
function unescapeAnchorsOnly(html) {
  if (!html || typeof html !== 'string') return html;
  // Replace patterns like &lt;a ...&gt;...&lt;/a&gt; to <a ...>...</a>
  // Remove any inline event handlers and javascript: URLs in attrs for a basic safeguard
  return html.replace(/&lt;a\b([^&]*)&gt;([\s\S]*?)&lt;\/a&gt;/gi, (match, attrs, inner) => {
    let safeAttrs = attrs || '';
    // Strip on*="..." handlers and on*='...'
    safeAttrs = safeAttrs.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
                         .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
    // Neutralize javascript: protocols
    safeAttrs = safeAttrs.replace(/javascript:/gi, '');
    return `<a${safeAttrs}>${inner}</a>`;
  });
}

async function fetchParentChain(start) {
  const chain = [];
  let cur = start && start.parent_id ? { id: start.parent_id } : null;
  let guard = 0;
  while (cur && cur.id && guard++ < 12) {
    const { data, error } = await supabase
      .from('pages')
      .select('id, title, slug, parent_id')
      .eq('id', cur.id)
      .single();
    if (error || !data) break;
    chain.push(data);
    cur = data.parent_id ? { id: data.parent_id } : null;
  }
  return chain.reverse();
}

async function renderBreadcrumbs(page) {
  const header = document.querySelector('.page-header');
  if (!header) return;
  let bc = document.getElementById('breadcrumbs');
  if (!bc) {
    bc = document.createElement('nav');
    bc.id = 'breadcrumbs';
    bc.setAttribute('aria-label', 'Breadcrumb');
    bc.style.marginBottom = '0.5rem';
    bc.style.fontSize = '0.85rem';
    header.parentElement.insertBefore(bc, header);
  }
  const parents = await fetchParentChain(page);
  const parts = [];
  parts.push(`<a href="index.html" class="text-gold" style="text-decoration:none;">Anasayfa</a>`);
  parents.forEach(p => {
    parts.push(`<a href="page.html?slug=${encodeURIComponent(p.slug)}" class="text-gold" style="text-decoration:none;">${p.title || '(sayfa)'}</a>`);
  });
  parts.push(`<span aria-current="page" class="text-gray-300">${page.title || '(bu sayfa)'}</span>`);
  bc.innerHTML = parts.join(' <span class="text-gray-500">›</span> ');
}

// Helper: turn image links into <img> elements
function materializeImageLinksInElement(rootEl) {
  if (!rootEl) return;
  const imgExtRe = /\.(png|jpe?g|gif|webp|svg|bmp|tiff)(\?.*)?$/i;

  // 1) <a href="...ext">text</a> -> <img src="...ext">
  rootEl.querySelectorAll('a[href]').forEach(a => {
    try {
      const href = a.getAttribute('href') || '';
      if (imgExtRe.test(href) && !a.querySelector('img')) {
        const img = document.createElement('img');
        img.src = href;
        img.alt = a.textContent || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        a.replaceWith(img);
      }
    } catch(_) { /* noop */ }
  });

  // 2) Plain text image URLs -> <img>
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|svg|bmp|tiff)(?:\?[^\s"'<>]*)?/i.test(node.nodeValue)) {
      textNodes.push(node);
    }
  }
  const urlRe = /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|svg|bmp|tiff)(?:\?[^\s"'<>]*)?)/ig;
  textNodes.forEach(tn => {
    const parent = tn.parentNode;
    if (!parent) return;
    const frag = document.createDocumentFragment();
    const parts = tn.nodeValue.split(urlRe);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (urlRe.test(part)) {
        const img = document.createElement('img');
        img.src = part;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        frag.appendChild(img);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    parent.replaceChild(frag, tn);
  });
}

// URL’den slug çek
const params = new URLSearchParams(window.location.search);
const slug = params.get("slug");

if (!slug) {
  document.querySelector("main").innerHTML = "<p>Sayfa bulunamadı.</p>";
  throw new Error("Slug yok");
}

// 🔹 Sayfa yükleme
async function loadPage() {
  let data = pageCache[slug] || null;
  let error = null;
  if (!data) {
    const resp = await supabase
      .from("pages")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .single();
    data = resp.data;
    error = resp.error;
    if (data && !error) pageCache[slug] = data;
  }

  if (error || !data) {
    document.querySelector("main").innerHTML = "<p>Sayfa bulunamadı veya yayında değil.</p>";
    return;
  }

  // Ana içerik
  document.getElementById("title").textContent = data.title;
  document.getElementById("meta").textContent = `Son güncelleme: ${new Date(data.updated_at).toLocaleString("tr-TR")}`;
  // Dynamic document title
  try { document.title = `Velmor Wiki - ${data.title || 'Sayfa'}`; } catch (_) {}
  const contentEl = document.getElementById('content');
  // Allow admins to type literal <a ...>...</a> into Quill (which stores them escaped)
  // Sanitize with DOMPurify (allowlist)
  const purifyCfg = {
    ALLOWED_TAGS: ['a','img','strong','em','u','s','p','br','ul','ol','li','blockquote','code','pre','h1','h2','h3','h4','span','div','hr','table','thead','tbody','tr','th','td'],
    ALLOWED_ATTR: ['href','src','alt','title','target','rel','class','style'],
    ALLOW_DATA_ATTR: false,
  };
  const processedHtml = unescapeAnchorsOnly(data.content);
  const sanitized = (window.DOMPurify ? window.DOMPurify.sanitize(processedHtml, purifyCfg) : processedHtml);
  contentEl.innerHTML = sanitized;
  
  // Dynamic meta tags
  try {
    const firstP = contentEl.querySelector('p');
    const desc = (firstP?.textContent || data.title || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    const canonicalUrl = `${location.origin}${location.pathname}?slug=${encodeURIComponent(data.slug)}`;
    const ogImage = document.querySelector('#page-sidebar img')?.getAttribute('src') ||
                    contentEl.querySelector('img')?.getAttribute('src') || '';

    function setMeta(name, content) {
      if (!content) return;
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    }
    function setProp(property, content) {
      if (!content) return;
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.appendChild(el); }
      el.setAttribute('content', content);
    }
    function setLink(rel, href) {
      if (!href) return;
      let el = document.querySelector(`link[rel="${rel}"]`);
      if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
      el.setAttribute('href', href);
    }

    setMeta('description', desc);
    setProp('og:title', data.title || 'Velmor Wiki');
    setProp('og:description', desc);
    if (ogImage) setProp('og:image', ogImage);
    setProp('og:type', 'article');
    setLink('canonical', canonicalUrl);
  } catch(_) { /* noop */ }
  // Breadcrumbs
  try {
    await renderBreadcrumbs({ id: data.id, title: data.title, slug: data.slug, parent_id: data.parent_id });
  } catch(_) { /* noop */ }
  // Convert image links (plain URLs or anchors) to <img>
  try { materializeImageLinksInElement(contentEl); } catch(_) { /* noop */ }
  // Normalize anchors (open in new tab, safe rel)
  try {
    contentEl.querySelectorAll('a').forEach(a => {
      if (!a.getAttribute('target')) a.setAttribute('target', '_self');
      const rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
      if (!rel.includes('noopener')) rel.push('noopener');
      if (!rel.includes('noreferrer')) rel.push('noreferrer');
      a.setAttribute('rel', rel.join(' '));
    });
  } catch (_) { /* noop */ }

  // Insert hr after each h2 within #content to match existing line style
  try {
    // remove previously auto-inserted separators (if re-rendered)
    contentEl?.querySelectorAll('hr[data-auto="1"]').forEach(el => el.remove());
    contentEl?.querySelectorAll('h2')?.forEach((h2) => {
      const hr = document.createElement('hr');
      hr.className = 'border-border-dark my-2';
      hr.dataset.auto = '1';
      h2.insertAdjacentElement('afterend', hr);
    });

    // Image lightbox wiring (event delegation)
    const imageModal = document.getElementById('imageModal');
    const imageBackdrop = document.getElementById('imageBackdrop');
    const closeImageModal = document.getElementById('closeImageModal');
    const lightboxImage = document.getElementById('lightboxImage');

    function openLightbox(src) {
      if (!imageModal || !imageBackdrop || !lightboxImage) return;
      lightboxImage.src = src;
      imageModal.style.display = 'flex';
      imageBackdrop.style.display = 'block';
    }

    function hideLightbox() {
      if (!imageModal || !imageBackdrop || !lightboxImage) return;
      imageModal.style.display = 'none';
      imageBackdrop.style.display = 'none';
      lightboxImage.src = '';
    }

    // Delegate clicks on images within #content
    contentEl?.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.tagName === 'IMG') {
        e.preventDefault();
        openLightbox(target.src);
      }
    });

    // Delegate clicks on images within #page-sidebar (e.g., infobox tables)
    const sidebarEl = document.getElementById('page-sidebar');
    sidebarEl?.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.tagName === 'IMG') {
        e.preventDefault();
        openLightbox(target.src);
      }
    });

    closeImageModal?.addEventListener('click', hideLightbox);
    imageBackdrop?.addEventListener('click', hideLightbox);
    imageModal?.addEventListener('click', (e) => {
      if (e.target === imageModal) hideLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideLightbox();
    });
  } catch (e) {
    // no-op if content is not well-formed
  }

  // Görsel (varsa)
  const imgContainer = document.getElementById('page-image');
  if (data.image_url && imgContainer) {
    imgContainer.innerHTML = `<img src="${data.image_url}" alt="${data.title}" class="w-full max-h-96 object-cover rounded" />`;
  } else if (imgContainer) {
    imgContainer.innerHTML = '';
  }

  // Sidebar info parsing and rendering
  const sidebarEl = document.getElementById('page-sidebar');
  if (data.sidebar_info && sidebarEl) {
    let parsed = null;
    // Try JSON parse first
    try {
      parsed = typeof data.sidebar_info === 'object' ? data.sidebar_info : JSON.parse(data.sidebar_info);
    } catch (e) {
      // not JSON — treat as raw HTML
      sidebarEl.style.display = 'block';
      sidebarEl.innerHTML = data.sidebar_info;
      parsed = null;
    }

    if (parsed) {
      // Support two shapes: { title, image, fields: { key: value } } OR array of sections
      const buildTable = (obj) => {
        const rows = [];
        if (obj.image) {
          rows.push(`<tr><td colspan="2" class="text-center"><img src="${obj.image}" alt="" class="mx-auto mb-2"/></td></tr>`);
        }
        if (obj.title) {
          rows.push(`<tr><td colspan="2" class="text-center font-bold pb-2">${obj.title}</td></tr>`);
        }
        if (obj.fields) {
          if (Array.isArray(obj.fields)) {
            // preserve saved order
            obj.fields.forEach(({ key, value }) => {
              if (!key) return;
              rows.push(`<tr><td class="font-semibold pr-2 text-sm text-gray-300">${key}</td><td class="text-sm text-white">${value ?? ''}</td></tr>`);
            });
          } else if (typeof obj.fields === 'object') {
            // backward compatibility
            for (const [k, v] of Object.entries(obj.fields)) {
              rows.push(`<tr><td class="font-semibold pr-2 text-sm text-gray-300">${k}</td><td class="text-sm text-white">${v}</td></tr>`);
            }
          }
        }
        return `<table class="w-full text-sm">${rows.join('')}</table>`;
      };

      let html = '';
      if (Array.isArray(parsed)) {
        html = parsed.map(s => buildTable(s)).join('<hr class="my-2 border-border-dark"/>');
      } else {
        html = buildTable(parsed);
      }

      sidebarEl.style.display = 'block';
      sidebarEl.innerHTML = html;
    }
  } else if (sidebarEl) {
    sidebarEl.style.display = 'none';
    sidebarEl.innerHTML = '';
  }

  // 🔸 ALT SAYFALAR
  const { data: childPages } = await supabase
    .from("pages")
    .select("title, slug")
    .eq("parent_id", data.id)
    .eq("status", "published");

  const childList = document.getElementById("child-pages");
  if (childPages?.length) {
    document.getElementById("child-section").style.display = "block";
    // sort alphabetically by title (Turkish locale)
    childPages.sort((a, b) => (a.title || "").localeCompare(b.title || "", 'tr', { sensitivity: 'base' }));
    childList.innerHTML = childPages
      .map(p => `<li><a class="block border border-border-dark p-3 hover:bg-white/10 transition text-white" href="page.html?slug=${p.slug}">${p.title}</a></li>`)
      .join("");
    const childHeader = document.getElementById("child-header");
    const childContent = document.getElementById("child-content");
    const childIcon = document.getElementById("child-toggle-icon");
    if (childHeader && childContent && childIcon) {
      // initial: expanded
      childContent.style.display = "block";
      // aria and icon state
      childHeader.setAttribute('aria-expanded', 'true');
      childIcon.classList.remove('rotate-90');

      const toggleChild = () => {
        const isOpen = childContent.style.display !== "none";
        const willOpen = !isOpen;
        childContent.style.display = willOpen ? "block" : "none";
        childHeader.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (!willOpen) {
          childIcon.classList.add('rotate-90');
        } else {
          childIcon.classList.remove('rotate-90');
        }
      };

      childHeader.onclick = toggleChild;
      childHeader.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleChild();
        }
      };
    }
  } else {
    document.getElementById("child-section").style.display = "none";
  }

  // 🔸 ETİKETLER (yalnızca etiket çubuğunu göster)
  if (data.tags?.length) {
    const tagsBar = document.getElementById('tags-bar');
    if (tagsBar) {
      tagsBar.innerHTML = '';
      const tagContainer = document.createElement('p');
      tagContainer.className = 'text-sm text-text-dark';
      tagContainer.dataset.auto = 'tags';
      tagContainer.innerHTML = 'Etiketler: ' + data.tags
        .map(t => `<a class="text-text-dark hover:text-gold" href="tag.html?name=${encodeURIComponent(t)}">${t}</a>`)
        .join(', ');
      tagsBar.appendChild(tagContainer);
    }
  }

  // Recently visited: push this page to localStorage
  try {
    const rec = { slug: data.slug, title: data.title, visited_at: new Date().toISOString() };
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem('recentVisited') || '[]'); } catch (_) { arr = []; }
    arr = Array.isArray(arr) ? arr.filter(it => it && it.slug !== rec.slug) : [];
    arr.unshift(rec);
    if (arr.length > 20) arr = arr.slice(0, 20);
    localStorage.setItem('recentVisited', JSON.stringify(arr));
  } catch (_) { /* noop */ }
}

loadPage();