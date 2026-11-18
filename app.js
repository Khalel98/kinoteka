"use strict";

/* ---------- Хранилище: фильмы лежат в IndexedDB прямо на телефоне ---------- */

const DB_NAME = "kinoteka";
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("films"); // id -> Blob (само видео)
        d.createObjectStore("meta");  // id -> { size, name, added }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("aborted"));
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function loadMeta() {
  return tx(["meta"], "readonly", async (t) => {
    const s = t.objectStore("meta");
    const [keys, vals] = await Promise.all([reqP(s.getAllKeys()), reqP(s.getAll())]);
    const map = new Map();
    keys.forEach((k, i) => map.set(k, vals[i]));
    return map;
  });
}

function saveFilm(id, file) {
  return tx(["films", "meta"], "readwrite", (t) => {
    t.objectStore("films").put(file, id);
    t.objectStore("meta").put({ size: file.size, name: file.name, added: Date.now() }, id);
  });
}

function getFilm(id) {
  return tx(["films"], "readonly", (t) => reqP(t.objectStore("films").get(id)));
}

function deleteFilm(id) {
  return tx(["films", "meta"], "readwrite", (t) => {
    t.objectStore("films").delete(id);
    t.objectStore("meta").delete(id);
  });
}

/* ---------- Прогресс просмотра (маленькие данные — localStorage) ---------- */

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const progress = {
  get(id) {
    const pos = parseFloat(ls.get("kt:pos:" + id)) || 0;
    const dur = parseFloat(ls.get("kt:dur:" + id)) || 0;
    return { pos, dur, watched: ls.get("kt:w:" + id) === "1" };
  },
  save(id, pos, dur) {
    ls.set("kt:pos:" + id, String(Math.floor(pos)));
    if (dur) ls.set("kt:dur:" + id, String(Math.floor(dur)));
  },
  finish(id) { ls.del("kt:pos:" + id); ls.set("kt:w:" + id, "1"); },
  clear(id) { ls.del("kt:pos:" + id); ls.del("kt:w:" + id); },
};

/* ---------- Утилиты ---------- */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1).replace(".", ",") + " ГБ";
  return Math.max(1, Math.round(bytes / 1e6)) + " МБ";
}
function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

let toastTimer;
function toast(msg, sticky = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
const hideToast = () => { $("#toast").hidden = true; };

/* ---------- Состояние и отрисовка ---------- */

let local = new Map(); // id -> meta
let filter = ls.get("kt:tab");
const byId = new Map(MOVIES.map((m) => [m.id, m]));

async function refresh() {
  try { local = await loadMeta(); } catch (e) { console.error(e); local = new Map(); }
  if (filter !== "local" && filter !== "all") filter = local.size ? "local" : "all";
  render();
}

function render() {
  document.querySelectorAll(".tab").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.filter === filter));
    const n = b.dataset.filter === "local" ? local.size : MOVIES.length;
    b.textContent = b.dataset.filter === "local" ? "На телефоне" : "Все фильмы";
    b.append(el("span", "count", String(n)));
  });

  const total = [...local.values()].reduce((s, m) => s + (m.size || 0), 0);
  $("#storage").textContent = local.size
    ? `${local.size} ${plural(local.size, "фильм", "фильма", "фильмов")} офлайн · ${fmtSize(total)}`
    : "Фильмы ещё не добавлены";

  const list = filter === "local" ? MOVIES.filter((m) => local.has(m.id)) : MOVIES;
  const grid = $("#grid");
  grid.replaceChildren();
  $("#empty").hidden = list.length > 0;

  for (const m of list) {
    const isLocal = local.has(m.id);
    const p = progress.get(m.id);
    const card = el("button", "card " + (isLocal ? "local" : "remote") + (p.watched ? " watched" : ""));
    card.setAttribute("aria-label", `${m.title}, ${m.year || ""}${isLocal ? "" : ", не скачан"}`);
    const poster = el("div", "poster");
    const img = el("img");
    img.src = m.poster; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    poster.append(img);
    if (isLocal && p.pos > 0 && p.dur > 0) {
      const bar = el("div", "progress"), fill = el("i");
      fill.style.width = Math.min(100, (p.pos / p.dur) * 100) + "%";
      bar.append(fill); poster.append(bar);
    }
    poster.append(el("span", "badge", isLocal ? (p.watched ? "✓" : "▶") : "+"));
    card.append(poster, el("p", "card-title", m.title), el("p", "card-year", m.year ? String(m.year) : ""));
    card.addEventListener("click", () => openSheet(m));
    grid.append(card);
  }
}

document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => { filter = b.dataset.filter; ls.set("kt:tab", filter); render(); window.scrollTo(0, 0); })
);

/* ---------- Карточка фильма и плеер ---------- */

const player = $("#player");
let current = null;   // открытый фильм
let objectUrl = null;
let lastSave = 0;

function persistPos() {
  if (!current || !player.src || !player.duration) return;
  if (player.currentTime > player.duration - 120) progress.finish(current.id);
  else if (player.currentTime > 5) progress.save(current.id, player.currentTime, player.duration);
}

player.addEventListener("timeupdate", () => {
  const now = Date.now();
  if (now - lastSave > 5000) { lastSave = now; persistPos(); }
});
player.addEventListener("pause", persistPos);
player.addEventListener("webkitendfullscreen", persistPos);
player.addEventListener("ended", () => { if (current) progress.finish(current.id); });
document.addEventListener("visibilitychange", () => { if (document.hidden) persistPos(); });

function releasePlayer() {
  persistPos();
  player.pause();
  player.removeAttribute("src");
  player.load();
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
}

async function openSheet(m) {
  releasePlayer();
  current = m;
  const isLocal = local.has(m.id);
  $("#d-title").textContent = m.title;
  $("#d-meta").textContent = [m.year, m.genre, isLocal ? fmtSize(local.get(m.id).size) : null].filter(Boolean).join(" · ");
  $("#d-desc").textContent = m.description;
  $("#d-actors").textContent = "В ролях: " + m.actors;
  player.poster = m.poster;
  $(".player-wrap").classList.toggle("poster-only", !isLocal);
  player.controls = isLocal;

  const actions = $("#d-actions");
  actions.replaceChildren();
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";

  if (!isLocal) {
    const add = el("button", "btn", "Добавить файл");
    add.addEventListener("click", () => { pendingMovie = m; $("#file-one").value = ""; $("#file-one").click(); });
    actions.append(add, el("p", "note", "Фильма ещё нет на телефоне. Перекиньте файл с Mac через AirDrop и выберите его здесь."));
    return;
  }

  const p = progress.get(m.id);
  const resume = p.pos > 0 && !p.watched;
  const play = el("button", "btn", resume ? `Продолжить с ${fmtTime(p.pos)}` : "Смотреть");
  play.disabled = true;
  actions.append(play);
  let restart;
  if (resume || p.watched) {
    restart = el("button", "btn btn-ghost", "Смотреть сначала");
    restart.disabled = true;
    actions.append(restart);
  }
  const del = el("button", "btn btn-danger", "Удалить с телефона");
  actions.append(del);

  const start = (from) => {
    player.currentTime = from;
    const pr = player.play();
    if (pr && pr.catch) pr.catch(() => {});
    try {
      if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
      else if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
    } catch {}
  };
  play.addEventListener("click", () => start(resume ? p.pos : 0));
  if (restart) restart.addEventListener("click", () => { progress.clear(m.id); start(0); });
  del.addEventListener("click", async () => {
    if (!confirm(`Удалить «${m.title}» с телефона? Постер и описание останутся, файл можно добавить снова.`)) return;
    releasePlayer();
    await deleteFilm(m.id);
    progress.clear(m.id);
    closeSheet();
    await refresh();
    toast("Фильм удалён, место освобождено");
  });

  try {
    const blob = await getFilm(m.id);
    if (current !== m) return; // пользователь уже открыл другой фильм
    if (!blob) throw new Error("no blob");
    objectUrl = URL.createObjectURL(blob);
    player.src = objectUrl;
    player.addEventListener("loadedmetadata", () => {
      play.disabled = false;
      if (restart) restart.disabled = false;
      if (resume) player.currentTime = p.pos;
    }, { once: true });
    player.load();
  } catch (e) {
    console.error(e);
    play.textContent = "Файл недоступен — добавьте заново";
    toast("Не удалось открыть файл фильма");
  }
}

function closeSheet() {
  releasePlayer();
  current = null;
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
  render();
}
$("#sheet-close").addEventListener("click", closeSheet);
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

/* ---------- Добавление фильмов ---------- */

let pendingMovie = null;
let busy = false;

async function storeFile(m, file, label = "") {
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (est && est.quota && file.size > est.quota - est.usage) {
      toast(`Не хватает места: нужно ${fmtSize(file.size)}, доступно ${fmtSize(est.quota - est.usage)}`);
      return false;
    }
  } catch {}
  toast(`${label}Сохраняю «${m.title}» (${fmtSize(file.size)})… Не закрывайте приложение`, true);
  try {
    await saveFilm(m.id, file);
    progress.clear(m.id);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return true;
  } catch (e) {
    console.error(e);
    toast(e && e.name === "QuotaExceededError" ? "Не хватает места на телефоне" : "Не удалось сохранить файл");
    return false;
  }
}

$("#file-one").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const m = pendingMovie;
  pendingMovie = null;
  if (!file || !m || busy) return;
  busy = true;
  const ok = await storeFile(m, file);
  busy = false;
  if (ok) {
    await refresh();
    toast(`«${m.title}» теперь доступен офлайн`);
    if (current === m) openSheet(m);
  }
});

const norm = (s) => s.normalize("NFC").toLowerCase()
  .replace(/\.(mp4|m4v|mov)$/, "")
  .replace(/-kinovasek\.net/, "")
  .replace(/[^a-z0-9а-яё]/g, "");

function matchFile(name) {
  const n = norm(name);
  if (!n) return null;
  return MOVIES.find((m) => norm(m.file) === n)
    || MOVIES.find((m) => n.startsWith(norm(m.file)) || norm(m.file).startsWith(n) && n.length > 6)
    || null;
}

function askMovie(file) {
  return new Promise((resolve) => {
    $("#a-file").textContent = `${file.name} · ${fmtSize(file.size)}`;
    const list = $("#a-list");
    list.replaceChildren();
    const options = [...MOVIES].sort((a, b) => local.has(a.id) - local.has(b.id));
    for (const m of options) {
      const b = el("button", "assign-item");
      const img = el("img"); img.src = m.poster; img.alt = "";
      const txt = el("span", null, `${m.title}${m.year ? " (" + m.year + ")" : ""}${local.has(m.id) ? " · уже есть" : ""}`);
      b.append(img, txt);
      b.addEventListener("click", () => done(m));
      list.append(b);
    }
    const skip = () => done(null);
    $("#a-skip").addEventListener("click", skip, { once: true });
    $("#assign").hidden = false;
    function done(m) {
      $("#a-skip").removeEventListener("click", skip);
      $("#assign").hidden = true;
      resolve(m);
    }
  });
}

$("#bulk-btn").addEventListener("click", () => {
  $("#help").hidden = true;
  $("#file-many").value = "";
  $("#file-many").click();
});

$("#file-many").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  if (!files.length || busy) return;
  busy = true;
  let saved = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const m = matchFile(f.name) || (hideToast(), await askMovie(f));
    if (!m) continue;
    const label = files.length > 1 ? `${i + 1} из ${files.length}. ` : "";
    if (await storeFile(m, f, label)) saved++;
    await refresh();
  }
  busy = false;
  toast(saved ? `Добавлено: ${saved} ${plural(saved, "фильм", "фильма", "фильмов")}` : "Ничего не добавлено");
});

/* ---------- Справка, подсказка установки, офлайн-режим ---------- */

$("#help-btn").addEventListener("click", () => { $("#help").hidden = false; });
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => { $("#" + b.dataset.close).hidden = true; })
);
$("#help").addEventListener("click", (e) => { if (e.target.id === "help") $("#help").hidden = true; });

const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document);
$("#install-hint").hidden = standalone || !isIOS;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(console.error));
}

refresh();
