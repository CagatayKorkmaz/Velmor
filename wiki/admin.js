import { supabase } from "./supabase.js";

const pageList = document.getElementById("page-list");
const pageSearch = document.getElementById("page-search");
const newBtn = document.getElementById("new-page");
const logoutBtn = document.getElementById("logout");
const titleInput = document.getElementById("page-title");
const slugInput = document.getElementById("page-slug");
const statusSelect = document.getElementById("page-status");
const saveBtn = document.getElementById("save-page");
const deleteBtn = document.getElementById("delete-page");
const editorTitle = document.getElementById("editor-title");
const slugLock = document.getElementById("slug-lock");
const toastContainer = document.getElementById("toastContainer");
const confirmModal = document.getElementById('confirmModal');
const confirmBackdrop = document.getElementById('confirmBackdrop');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');

let settingProgrammaticSlug = false;
let isDirty = false;
let searchTimer = null;

function toast(message, type = 'info') {
  if (!toastContainer) { alert(message); return; }
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  toastContainer.appendChild(node);
  setTimeout(() => { node.remove(); }, 3000);
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const msgEl = document.getElementById('confirmMessage');
    if (msgEl) msgEl.textContent = message || 'Onaylıyor musunuz?';
    if (confirmBackdrop) confirmBackdrop.style.display = 'block';
    if (confirmModal) confirmModal.style.display = 'flex';

    const cleanup = () => {
      if (confirmBackdrop) confirmBackdrop.style.display = 'none';
      if (confirmModal) confirmModal.style.display = 'none';
      confirmYes?.removeEventListener('click', onYes);
      confirmNo?.removeEventListener('click', onNo);
      confirmBackdrop?.removeEventListener('click', onNo);
      document.removeEventListener('keydown', onKey);
    };
    const onYes = () => { cleanup(); resolve(true); };
    const onNo = () => { cleanup(); resolve(false); };
    const onKey = (e) => { if (e.key === 'Escape') { onNo(); } };
    confirmYes?.addEventListener('click', onYes);
    confirmNo?.addEventListener('click', onNo);
    confirmBackdrop?.addEventListener('click', onNo);
    document.addEventListener('keydown', onKey);
  });
}

function setButtonLoading(btn, isLoading, loadingText) {
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText || btn.textContent;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
  } else {
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
  }
}

let selectedPage = null;
let allPages = [];

function renderPageList(items) {
  pageList.innerHTML = "";
  items.forEach((p) => {
    const div = document.createElement("div");
    div.textContent = p.title || "(başlıksız)";
    div.classList.add("page-item");
    if (selectedPage && p.id === selectedPage.id) div.classList.add('selected');
    div.onclick = () => selectPage(p);
    pageList.appendChild(div);
  });
}

// Quill editor setup
const quill = new Quill("#editor", {
  theme: "snow",
  placeholder: "Sayfa içeriğini buraya yaz...",
  modules: {
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline"],
        ["image", "link"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["clean"]
      ],
      handlers: {
        image: imageHandler
      }
    }
  }
});

quill.on('text-change', () => { isDirty = true; });

// Helper: create URL-friendly slug from title
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFKD') // remove accents
    .replace(/\s+/g, '-') // spaces to -
    .replace(/[^a-z0-9-_]/g, '') // remove invalid chars
    .replace(/--+/g, '-') // collapse dashes
    .replace(/^-+|-+$/g, ''); // trim dashes
}

async function imageHandler() {
  // 1) URL ile ekleme
  const url = window.prompt("Resim URL'si (boş bırakırsanız bilgisayardan yükleme açılır)");
  const range = quill.getSelection() || { index: quill.getLength(), length: 0 };
  if (url && /^https?:\/\//i.test(url)) {
    quill.insertEmbed(range.index, "image", url.trim());
    return;
  }

  // 2) Dosyadan yükleme (Supabase Storage)
  const input = document.createElement("input");
  input.setAttribute("type", "file");
  input.setAttribute("accept", "image/*");
  input.click();

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const fileName = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage
      .from("images")
      .upload(fileName, file);

    if (error) {
      toast("Yükleme başarısız: " + error.message, 'error');
      return;
    }

    const { data: publicData } = supabase.storage
      .from("images")
      .getPublicUrl(fileName);

    quill.insertEmbed(range.index, "image", publicData.publicUrl);
  };
}

// Oturum kontrolü
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  window.location.href = "index.html";
}

// Kullanıcının profilini al
const { data: profile } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", user.id)
  .single();

const isAdmin = profile?.role === "admin";
const isWriter = profile?.role === "writer";
if (deleteBtn) {
  deleteBtn.disabled = !isAdmin;
  if (!isAdmin) { deleteBtn.style.opacity = '0.6'; deleteBtn.style.pointerEvents = 'none'; }
}
// Writers cannot publish: disable option and default to draft
if (isWriter && statusSelect) {
  [...statusSelect.options].forEach(opt => { if (opt.value === 'published') opt.disabled = true; });
  if (statusSelect.value === 'published') statusSelect.value = 'draft';
}

// Sayfaları getir
async function loadPages() {
  const { data, error } = await supabase
    .from("pages")
    .select("id, title, slug, created_at, updated_at, status, content, parent_id, tags, sidebar_info")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return console.error(error);
  allPages = data || [];
  renderPageList(allPages);
}

function applySearchFilter() {
  const q = (pageSearch?.value || "").trim().toLowerCase();
  if (!q) { renderPageList(allPages); return; }
  const filtered = allPages.filter(p => {
    const t = (p.title || "").toLowerCase();
    const s = (p.slug || "").toLowerCase();
    return t.includes(q) || s.includes(q);
  });
  renderPageList(filtered);
}

// Slug auto-generate when lock is on
titleInput.addEventListener('input', () => {
  if (slugLock?.checked) {
    const next = slugify(titleInput.value.trim());
    settingProgrammaticSlug = true;
    slugInput.value = next;
    settingProgrammaticSlug = false;
  }
  isDirty = true;
});

// If user edits the slug manually, unlock auto-generation
slugInput.addEventListener('input', () => {
  if (settingProgrammaticSlug) return;
  if (slugLock && slugLock.checked) slugLock.checked = false;
  isDirty = true;
});

function selectPage(page) {
  selectedPage = page;
  editorTitle.textContent = "Düzenleniyor: " + page.title;
  titleInput.value = page.title || "";
  slugInput.value = page.slug || "";
  statusSelect.value = page.status || "draft";
  quill.root.innerHTML = page.content || "";
  try {
    const expected = slugify(page.title || "");
    if (slugLock) slugLock.checked = (page.slug || "") === expected;
  } catch (_) {
    if (slugLock) slugLock.checked = false;
  }
  const parentSelect = document.getElementById("parentPage");
  if (parentSelect) parentSelect.value = page.parent_id || "";
  const tagsInput = document.getElementById("tags");
  if (tagsInput) tagsInput.value = Array.isArray(page.tags) ? page.tags.join(", ") : (page.tags || "");
  try { loadSidebarIntoBuilder(page.sidebar_info); } catch (e) { /* ignore */ }
  isDirty = false;
  // re-render list to reflect selected highlight (respect active filter)
  applySearchFilter();
}

async function savePage() {
  // Ortak alanları alalım
  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();
  const status = statusSelect.value;
  const content = quill.root.innerHTML;

  const parent_id = document.getElementById("parentPage")?.value || null;
  const tagsInput = document.getElementById("tags")?.value.trim() || "";
  const tags = tagsInput ? tagsInput.split(",").map(t => t.trim()).filter(Boolean) : [];

  // Generate slug from title if empty
  const finalSlug = slug || slugify(title || "");

  // Basic validation
  if (!title) { toast("Lütfen bir başlık girin.", 'error'); return; }
  if (!finalSlug) { toast("Geçerli bir slug oluşturulamadı. Lütfen slug girin.", 'error'); return; }
  if (isWriter && status === 'published') { toast('Yazarlar yayına alamaz. Lütfen Taslak olarak kaydedin.', 'error'); return; }

  // Check slug uniqueness (exclude current page when updating)
  const { data: existing, error: checkError } = await supabase
    .from("pages")
    .select("id")
    .eq("slug", finalSlug)
    .limit(1);

  if (checkError) {
    console.error("Slug kontrol hatası:", checkError);
    toast("Slug kontrolü sırasında hata oluştu.", 'error');
    return;
  }

  const slugConflict = existing && existing.length && (!selectedPage || existing[0].id !== selectedPage.id);
  if (slugConflict) { toast("Bu slug zaten kullanılıyor.", 'error'); return; }

  const data = {
    title,
    slug: finalSlug,
    status,
    content,
    author_id: user.id,
    parent_id,
    tags,
    sidebar_info: (() => {
      const out = builderState.map(sec => {
        const obj = {};
        if (sec.title) obj.title = sec.title;
        if (sec.image) obj.image = sec.image;
        if (sec.fields && sec.fields.length) {
          obj.fields = sec.fields.filter(f => f.key && (f.value || f.value === ''))
                                 .map(f => ({ key: f.key, value: f.value }));
        }
        return obj;
      });
      if (!out.length) return null;
      return out.length === 1 ? out[0] : out;
    })(),
  };

  setButtonLoading(saveBtn, true, 'Kaydediliyor...');
  saveBtn && (saveBtn.disabled = true);
  try {
    if (selectedPage) {
      const { error } = await supabase
        .from("pages")
        .update(data)
        .eq("id", selectedPage.id);
      if (error) toast("Kaydedilirken hata: " + error.message, 'error');
      else toast("Sayfa güncellendi!", 'success');
    } else {
      const { error } = await supabase
        .from("pages")
        .insert([data]);
      if (error) toast("Ekleme hatası: " + error.message, 'error');
      else toast("Yeni sayfa eklendi!", 'success');
    }
    await loadPages();
    isDirty = false;
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

const uploadButton = document.getElementById("uploadButton");
const imageUpload = document.getElementById("imageUpload");
const uploadStatus = document.getElementById("uploadStatus");
const uploadPreview = document.getElementById("uploadPreview");
const insertUploadedBtn = document.getElementById("insertUploadedBtn");
let lastUploadedUrl = '';

imageUpload?.addEventListener('change', () => {
  const file = imageUpload.files && imageUpload.files[0];
  if (!file) {
    if (uploadPreview) { uploadPreview.style.display = 'none'; uploadPreview.src = ''; }
    if (insertUploadedBtn) insertUploadedBtn.style.display = 'none';
    return;
  }
  if (uploadPreview) {
    uploadPreview.src = URL.createObjectURL(file);
    uploadPreview.style.display = 'block';
  }
  if (insertUploadedBtn) insertUploadedBtn.style.display = 'none';
});

uploadButton?.addEventListener("click", async () => {
  if (!imageUpload.files.length) {
    uploadStatus.textContent = " Lütfen bir dosya seç.";
    return;
  }

  const file = imageUpload.files[0];
  const fileName = `${Date.now()}-${file.name}`;
  uploadStatus.textContent = " Yükleniyor...";

  const { data, error } = await supabase.storage
    .from("images")
    .upload(fileName, file);

  if (error) {
    console.error(error);
    uploadStatus.textContent = " Yükleme başarısız.";
    return;
  }

  // Public URL oluştur
  const { data: publicData } = supabase.storage
    .from("images")
    .getPublicUrl(fileName);

  uploadStatus.innerHTML = `
    <a href="${publicData.publicUrl}" target="_blank">Yüklendi — Görsele Git</a>
  `;

  // Bonus: linki panoya kopyalayalım (editöre kolay eklenir)
  navigator.clipboard.writeText(publicData.publicUrl);
  lastUploadedUrl = publicData.publicUrl;
  if (uploadPreview) { uploadPreview.src = publicData.publicUrl; uploadPreview.style.display = 'block'; }
  if (insertUploadedBtn) insertUploadedBtn.style.display = 'inline-block';
});

insertUploadedBtn?.addEventListener('click', () => {
  if (!lastUploadedUrl) { toast('Önce görseli yükleyin.', 'error'); return; }
  const range = quill.getSelection() || { index: quill.getLength(), length: 0 };
  quill.insertEmbed(range.index, 'image', lastUploadedUrl);
  toast('Görsel editöre eklendi.', 'success');
});

async function loadParentPages() {
  const { data, error } = await supabase
    .from("pages")
    .select("id, title")
    .order("title");

  if (error) {
    console.error("Üst sayfalar alınamadı:", error);
    return;
  }

  const select = document.getElementById("parentPage");
  data.forEach((page) => {
    const option = document.createElement("option");
    option.value = page.id;
    option.textContent = page.title;
    select.appendChild(option);
  });
}

loadParentPages();

// Sidebar helpers removed: JSON textarea no longer present; use builder directly

// ---------------- Infobox Builder ----------------
const builderSectionsEl = document.getElementById('builderSections');
const addSectionBtn = document.getElementById('addSectionBtn');
const exportBuilderBtn = document.getElementById('exportBuilderBtn');

let builderState = [];

function renderBuilder() {
  if (!builderSectionsEl) return;
  builderSectionsEl.innerHTML = '';
  builderState.forEach((sec, si) => {
    const secEl = document.createElement('div');
    secEl.style.border = '1px solid #222';
    secEl.style.padding = '8px';
    secEl.style.marginBottom = '8px';
    secEl.dataset.index = String(si);
    secEl.draggable = true;
    secEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
        <span title="Sürükle" style="cursor:grab; user-select:none;">☰</span>
        <input data-sec-title placeholder="Bölüm başlığı (isteğe bağlı)" style="flex:1; padding:6px;" value="${sec.title || ''}" />
        <button data-remove-sec type="button">Bölüm Sil</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
        <input data-sec-image placeholder="Bölüm görsel URL (isteğe bağlı)" style="flex:1; padding:6px;" value="${sec.image || ''}" />
      </div>
      <div data-fields></div>
      <div style="margin-top:6px; display:flex; gap:8px;">
        <button data-add-field type="button">Alan Ekle</button>
      </div>
    `;

    // fields container
    const fieldsContainer = secEl.querySelector('[data-fields]');
    (sec.fields || []).forEach((f, fi) => {
      const fEl = document.createElement('div');
      fEl.style.display = 'flex';
      fEl.style.gap = '8px';
      fEl.style.marginTop = '6px';
      fEl.dataset.si = String(si);
      fEl.dataset.fi = String(fi);
      fEl.draggable = true;
      const drag = document.createElement('span'); drag.textContent = '⋮⋮'; drag.title = 'Sürükle'; drag.style.cursor = 'grab'; drag.style.userSelect = 'none'; drag.draggable = true;
      const keyInput = document.createElement('input');
      keyInput.placeholder = 'Alan';
      keyInput.value = f.key;
      const valInput = document.createElement('input');
      valInput.placeholder = 'Değer';
      valInput.value = f.value;
      const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'x';
      rm.addEventListener('click', () => {
        sec.fields.splice(fi, 1);
        renderBuilder();
      });
      keyInput.addEventListener('input', (e) => { sec.fields[fi].key = e.target.value; });
      valInput.addEventListener('input', (e) => { sec.fields[fi].value = e.target.value; });

      // Per-field drag handlers (on handle only)
      drag.addEventListener('dragstart', (ev) => {
        ev.stopPropagation();
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', `field:${si}:${fi}`);
      });

      fEl.appendChild(drag);
      fEl.appendChild(keyInput);
      fEl.appendChild(valInput);
      fEl.appendChild(rm);
      fieldsContainer.appendChild(fEl);
    });

    // wire section inputs
    const titleInput = secEl.querySelector('input[data-sec-title]');
    titleInput.addEventListener('input', (e) => { builderState[si].title = e.target.value; });
    const imageInput = secEl.querySelector('input[data-sec-image]');
    imageInput.addEventListener('input', (e) => { builderState[si].image = e.target.value; });
    secEl.querySelector('[data-add-field]')?.addEventListener('click', () => {
      builderState[si].fields = builderState[si].fields || [];
      builderState[si].fields.push({ key: '', value: '' });
      renderBuilder();
    });
    secEl.querySelector('[data-remove-sec]')?.addEventListener('click', () => {
      builderState.splice(si, 1);
      renderBuilder();
    });

    // Drag & drop for sections
    secEl.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', `sec:${si}`);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    secEl.addEventListener('dragover', (ev) => { ev.preventDefault(); });
    secEl.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const data = ev.dataTransfer.getData('text/plain');
      if (data.startsWith('sec:')) {
        const from = parseInt(data.split(':')[1], 10);
        let to = si;
        if (!Number.isNaN(from) && from !== to) {
          const item = builderState[from];
          // remove original
          builderState.splice(from, 1);
          // adjust index if moving downwards
          if (from < to) to = to - 1;
          builderState.splice(to, 0, item);
          renderBuilder();
        }
      }
    });

    // Drag & drop for fields (container-level: compute exact insert index)
    fieldsContainer.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    fieldsContainer.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const data = ev.dataTransfer.getData('text/plain');
      if (data.startsWith('field:')) {
        const [, s, f] = data.split(':');
        const fromSi = parseInt(s, 10);
        const fromFi = parseInt(f, 10);
        const toSi = si;
        if (Number.isNaN(fromSi) || Number.isNaN(fromFi)) return;
        const src = builderState[fromSi]?.fields || [];
        const dst = builderState[toSi].fields = builderState[toSi].fields || [];
        const item = src.splice(fromFi, 1)[0];
        if (!item) return;
        // Determine target index relative to field hovered
        let toFi = dst.length;
        const targetEl = ev.target.closest('[data-fi]');
        if (targetEl && targetEl.parentElement === fieldsContainer) {
          const rect = targetEl.getBoundingClientRect();
          const before = (ev.clientY - rect.top) < rect.height / 2;
          const targetIndex = parseInt(targetEl.dataset.fi || `${dst.length}`, 10);
          toFi = before ? targetIndex : targetIndex + 1;
        }
        if (fromSi === toSi && fromFi < toFi) toFi = toFi - 1; // adjust for same-list downward move
        if (toFi < 0) toFi = 0;
        if (toFi > dst.length) toFi = dst.length;
        dst.splice(toFi, 0, item);
        renderBuilder();
      }
    });

    builderSectionsEl.appendChild(secEl);
  });
}

addSectionBtn?.addEventListener('click', () => {
  builderState.push({ title: '', image: '', fields: [] });
  renderBuilder();
});

exportBuilderBtn?.addEventListener('click', async () => {
  const out = builderState.map(sec => {
    const obj = {};
    if (sec.title) obj.title = sec.title;
    if (sec.image) obj.image = sec.image;
    if (sec.fields && sec.fields.length) {
      obj.fields = {};
      sec.fields.forEach(f => { if (f.key) obj.fields[f.key] = f.value; });
    }
    return obj;
  });
  const finalJson = out.length === 1 ? out[0] : out;
  try {
    await navigator.clipboard.writeText(JSON.stringify(finalJson, null, 2));
    toast('Infobox JSON panoya kopyalandı.', 'success');
  } catch (e) {
    toast('Panoya kopyalanamadı.', 'error');
  }
});

// Helper: load sidebar_info into builderState (called from selectPage)
function loadSidebarIntoBuilder(value) {
  builderState = [];
  if (!value) { renderBuilder(); return; }
  let parsed = null;
  try { parsed = typeof value === 'object' ? value : JSON.parse(value); } catch (e) { parsed = null; }
  if (!parsed) { renderBuilder(); return; }
  if (Array.isArray(parsed)) {
    builderState = parsed.map(s => ({
      title: s.title || '',
      image: s.image || '',
      fields: Array.isArray(s.fields)
        ? s.fields.map(it => ({ key: it.key || '', value: it.value || '' }))
        : Object.entries(s.fields || {}).map(([k,v]) => ({ key:k, value:v }))
    }));
  } else {
    builderState = [{
      title: parsed.title || '',
      image: parsed.image || '',
      fields: Array.isArray(parsed.fields)
        ? parsed.fields.map(it => ({ key: it.key || '', value: it.value || '' }))
        : Object.entries(parsed.fields || {}).map(([k,v]) => ({ key:k, value:v }))
    }];
  }
  renderBuilder();
}

async function deletePage() {
  if (!selectedPage) return alert("Silinecek sayfa seçilmedi!");
  if (!isAdmin) { toast('Silme izniniz yok.', 'error'); return; }
  const ok = await showConfirm('Bu sayfayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.');
  if (!ok) return;
  setButtonLoading(deleteBtn, true, 'Siliniyor...');
  try {
    const { error } = await supabase.from("pages").delete().eq("id", selectedPage.id);
    if (error) toast("Silme hatası: " + error.message, 'error');
    else toast("Silindi!", 'success');
    selectedPage = null;
    editorTitle.textContent = "Sayfa Seçilmedi";
    quill.root.innerHTML = "";
    await loadPages();
  } finally {
    setButtonLoading(deleteBtn, false);
  }
}

newBtn.onclick = () => {
  selectedPage = null;
  editorTitle.textContent = "Yeni Sayfa";
  titleInput.value = "";
  slugInput.value = "";
  quill.root.innerHTML = "";
  if (slugLock) slugLock.checked = true;
  const parentSelect = document.getElementById("parentPage");
  if (parentSelect) parentSelect.value = "";
  const tagsInput = document.getElementById("tags");
  if (tagsInput) tagsInput.value = "";
  builderState = [];
  renderBuilder();
  isDirty = false;
};

saveBtn.onclick = savePage;
deleteBtn.onclick = deletePage;
logoutBtn.onclick = async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
};

// İlk yükleme
loadPages();

// Search events
pageSearch?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearchFilter, 300); });

window.addEventListener('beforeunload', (e) => {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); savePage(); }
});
