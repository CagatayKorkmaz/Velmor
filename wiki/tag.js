import { supabase } from './supabase.js';

// URL'den etiket ismini al
const tagName = new URLSearchParams(window.location.search).get("name");

if (!tagName) {
  document.querySelector("main").innerHTML = "<p>Etiket belirtilmemiş.</p>";
  throw new Error("Etiket yok");
}

// Sayfa başlığını ayarla
document.getElementById("tag-title").textContent = `Etiket: ${tagName}`;
document.title = `Velmor Wiki - Etiket: ${tagName}`;
// Açıklama metni
const tagDescEl = document.getElementById("tag-desc");
if (tagDescEl) {
  tagDescEl.textContent = "Seçtiğiniz etikete sahip bütün sayfalar listeleniyor.";
}

// Supabase'den verileri çek
async function loadTaggedPages() {
  const { data, error } = await supabase
    .from("pages")
    .select("title, slug, excerpt")
    .contains("tags", [tagName])
    .eq("status", "published")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Etiketli sayfalar alınamadı:", error);
    document.querySelector("main").innerHTML = "<p>Etiketli sayfalar yüklenemedi.</p>";
    return;
  }

  const list = document.getElementById("tag-pages");
  if (!data.length) {
    list.innerHTML = "<li>Bu etikete sahip sayfa bulunamadı.</li>";
    return;
  }

  list.innerHTML = data.map(p => `
    <li>
      <a href="page.html?slug=${p.slug}" class="block border border-border-dark p-3 hover:bg-white/10 transition text-white">
        <h3 class="text-lg font-semibold">${p.title}</h3>
        ${p.excerpt ? `<p class=\"text-sm text-gray-300 mt-1\">${p.excerpt}</p>` : ""}
      </a>
    </li>
  `).join("");
}

loadTaggedPages();
