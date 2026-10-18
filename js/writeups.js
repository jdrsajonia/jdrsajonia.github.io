/* ============================================================
   SPYNET · Writeups  —  renderizador estático
   - Lee writeups/index.json (árbol HTB / THM / ...)
   - Carga el .md seleccionado y lo renderiza con marked.js
   - Soporta: frontmatter YAML, callouts Obsidian [!tipo],
     wikilinks [[...]], rutas de imágenes relativas, y
     resaltado de sintaxis con highlight.js
   ============================================================ */

const MANIFEST_URL = "writeups/index.json";

const els = {
  tree: document.getElementById("tree"),
  content: document.getElementById("content"),
  sidebar: document.getElementById("sidebar"),
  backdrop: document.getElementById("backdrop"),
  menuBtn: document.getElementById("menuBtn"),
  footerCmd: document.getElementById("footerCmd"),
  footerCount: document.getElementById("footerCount"),
  footerUptime: document.getElementById("footerUptime"),
  footerYear: document.getElementById("footerYear"),
};

let MACHINES = []; // lista plana para routing

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function machineId(platform, name) { return platform + "/" + name; }
function dirOf(path) { return path.replace(/[^/]+$/, ""); }

/* ---------- frontmatter ---------- */
function parseFrontmatter(text) {
  const meta = {};
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta, body: text };
  m[1].split("\n").forEach((line) => {
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  });
  return { meta, body: text.slice(m[0].length) };
}

/* ---------- wikilinks [[...]] → span (sin destino real) ---------- */
function replaceWikilinks(md) {
  return md.replace(/\[\[([^\]\n]+)\]\]/g, (_, inner) => {
    const label = inner.split("|").pop().trim(); // soporta [[a|b]]
    return `<span class="wikilink">${escapeHtml(label)}</span>`;
  });
}

/* ---------- callouts Obsidian ( > [!tipo] Título ) ---------- */
function transformCallouts(root) {
  root.querySelectorAll("blockquote").forEach((bq) => {
    const first = bq.querySelector("p");
    if (!first) return;
    const m = first.innerHTML.match(/^\s*\[!(\w+)\]([^\n<]*)\n?([\s\S]*)$/);
    if (!m) return;

    const type = m[1].toLowerCase();
    const title = m[2].trim() || capitalize(type);
    const rest = m[3];

    bq.classList.add("callout", "callout-" + type);
    first.innerHTML = rest; // el cuerpo restante del primer párrafo

    const header = document.createElement("div");
    header.className = "callout-title";
    header.innerHTML =
      `<span class="callout-icon">${calloutIcon(type)}</span><span>${escapeHtml(title)}</span>`;
    bq.insertBefore(header, bq.firstChild);

    if (!first.textContent.trim() && !first.querySelector("img")) first.remove();
  });
}
function calloutIcon(type) {
  const map = {
    info: "ℹ️", note: "📝", abstract: "📋", summary: "📋",
    warning: "⚠️", caution: "⚠️", attention: "⚠️",
    danger: "⛔", bug: "🐞", error: "❌", failure: "❌",
    tip: "💡", hint: "💡", success: "✅", check: "✅",
  };
  return map[type] || "ℹ️";
}

/* ---------- render de un writeup ---------- */
async function renderWriteup(machine) {
  setActive(machine);
  els.footerCmd.textContent = "cat writeups/" + machine.id;
  els.content.innerHTML = `<p class="wu-loading">Cargando ${escapeHtml(machine.name)}…</p>`;

  let text;
  try {
    const res = await fetch(machine.path, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    text = await res.text();
  } catch (err) {
    els.content.innerHTML = `
      <div class="wu-error">
        <h2>No se pudo cargar el writeup</h2>
        <p>${escapeHtml(machine.path)}</p>
        <p style="color:var(--muted-dim)">${escapeHtml(String(err))}</p>
        <p style="color:var(--muted-dim);margin-top:1rem">
          Si abriste el archivo con <code>file://</code>, el navegador bloquea <code>fetch()</code>.
          Sirve el sitio por HTTP (o míralo en GitHub Pages).</p>
      </div>`;
    return;
  }

  const { meta, body } = parseFrontmatter(text);
  const md = replaceWikilinks(body);

  const doc = document.createElement("article");
  doc.className = "wu-doc";
  doc.innerHTML = marked.parse(md);

  // rutas de imágenes relativas → relativas a la carpeta del .md
  const base = dirOf(machine.path);
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (src && !/^(https?:)?\//i.test(src) && !src.startsWith("data:")) {
      img.setAttribute("src", base + src);
      img.setAttribute("loading", "lazy");
    }
  });

  transformCallouts(doc);

  // resaltado de sintaxis
  doc.querySelectorAll("pre code").forEach((block) => {
    try { hljs.highlightElement(block); } catch (_) {}
  });

  els.content.innerHTML = "";
  els.content.appendChild(buildMeta(meta));
  els.content.appendChild(doc);
  els.content.scrollIntoView({ block: "start" });
  window.scrollTo(0, 0);
  document.title = `SPYNET | ${machine.name}`;
}

function buildMeta(meta) {
  const wrap = document.createElement("div");
  wrap.className = "wu-meta";
  const badges = [
    meta.plataforma && ["Plataforma", meta.plataforma],
    meta.dificultad && ["Dificultad", meta.dificultad],
    meta.so && ["SO", meta.so],
    meta.estado && ["Estado", meta.estado],
    meta.fecha && ["Fecha", meta.fecha],
  ].filter(Boolean);
  if (badges.length === 0) { wrap.style.display = "none"; return wrap; }
  wrap.innerHTML = badges
    .map(([k, v]) => `<span class="wu-badge">${k}: <b>${escapeHtml(v)}</b></span>`)
    .join("");
  return wrap;
}

/* ---------- sidebar / árbol ---------- */
function diffClass(d) {
  const x = (d || "").toLowerCase();
  if (x.startsWith("ea") || x.startsWith("fá") || x.startsWith("fa")) return "diff-easy";
  if (x.startsWith("me")) return "diff-medium";
  if (x.startsWith("ha") || x.startsWith("di")) return "diff-hard";
  if (x.startsWith("in")) return "diff-insane";
  return "diff-easy";
}

function buildSidebar(manifest) {
  els.tree.innerHTML = "";
  MACHINES = [];

  manifest.platforms.forEach((plat) => {
    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML =
      `<span class="chev">▶</span>
       <span class="plat-label">${escapeHtml(plat.label || plat.name)}</span>
       <span class="count">${plat.machines.length}</span>`;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.className = "machines";

    if (plat.machines.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Próximamente…";
      ul.appendChild(li);
    } else {
      plat.machines.forEach((m) => {
        m.platform = plat.name;
        m.id = machineId(plat.name, m.name);
        MACHINES.push(m);

        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "machine-link";
        a.href = "#/" + encodeURI(m.id);
        a.dataset.id = m.id;
        a.innerHTML =
          `<span class="m-name">${escapeHtml(m.name)}</span>
           ${m.difficulty ? `<span class="diff ${diffClass(m.difficulty)}">${escapeHtml(m.difficulty)}</span>` : ""}`;
        li.appendChild(a);
        ul.appendChild(li);
      });
    }
    details.appendChild(ul);
    els.tree.appendChild(details);
  });
  els.footerCount.textContent = MACHINES.length;
}

function setActive(machine) {
  els.tree.querySelectorAll(".machine-link").forEach((a) => {
    a.classList.toggle("active", a.dataset.id === machine.id);
  });
}

/* ---------- routing (hash) ---------- */
function route() {
  const hash = decodeURI(location.hash.replace(/^#\/?/, ""));
  if (!hash) return; // deja el welcome
  const machine = MACHINES.find((m) => m.id === hash);
  if (machine) {
    renderWriteup(machine);
    closeSidebar();
  }
}

/* ---------- sidebar móvil ---------- */
function openSidebar() { els.sidebar.classList.add("open"); els.backdrop.classList.add("show"); }
function closeSidebar() { els.sidebar.classList.remove("open"); els.backdrop.classList.remove("show"); }
els.menuBtn.addEventListener("click", () =>
  els.sidebar.classList.contains("open") ? closeSidebar() : openSidebar());
els.backdrop.addEventListener("click", closeSidebar);

/* ---------- footer: año + tiempo de sesión ---------- */
els.footerYear.textContent = new Date().getFullYear();
const SESSION_START = Date.now();
setInterval(() => {
  const s = Math.floor((Date.now() - SESSION_START) / 1000);
  els.footerUptime.textContent = [s / 3600, (s % 3600) / 60, s % 60]
    .map((n) => String(Math.floor(n)).padStart(2, "0"))
    .join(":");
}, 1000);

/* ---------- init ---------- */
(async function init() {
  if (window.marked) {
    marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });
  }
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const manifest = await res.json();
    buildSidebar(manifest);
    window.addEventListener("hashchange", route);
    route(); // carga inicial si hay hash
  } catch (err) {
    els.tree.innerHTML =
      `<p class="wu-loading" style="color:var(--red)">No se pudo cargar el índice.<br>${escapeHtml(String(err))}</p>`;
  }
})();
