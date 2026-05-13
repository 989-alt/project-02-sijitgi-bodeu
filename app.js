// =============================================================
// 시 짓기 보드 — vanilla JS module
// 저장: localStorage (학급 단위 네임스페이스) + File System Access API (선택)
// 의존: window.html2canvas, window.html2pdf (CDN, 사용시점에 폴백)
// =============================================================

const LEGACY_POEMS_KEY = "sijitgi-bodeu.poems.v1";
const KEY_CLASSES = "sijitgi-bodeu.classes.v1";
const KEY_ACTIVE = "sijitgi-bodeu.activeClassId.v1";
const KEY_POEMS_PREFIX = "sijitgi-bodeu.poems.v2.";

const STATE = {
  /** @type {Array<{id:string,name:string,note:string,createdAt:string}>} */
  classes: [],
  /** @type {string|null} */
  activeId: null,
  /** @type {Array<Poem>} */
  poems: [],
  /** @type {FileSystemDirectoryHandle | null} */
  syncHandle: null,
  present: { index: 0, open: false },
};

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function escapeHTML(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitAcrostic(input) {
  const arr = [];
  for (const ch of String(input).normalize("NFC")) {
    if (/\s/.test(ch)) continue;
    arr.push(ch);
  }
  return arr;
}

function syllableCount(str) {
  let count = 0;
  for (const ch of String(str).normalize("NFC")) {
    if (/\s/.test(ch)) continue;
    count += 1;
  }
  return count;
}

function formatDate(d) {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

let toastTimer;
function toast(msg, variant = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (variant ? " " + variant : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

// ---------- 학급(workspace) ----------
function loadClasses() {
  try {
    const raw = localStorage.getItem(KEY_CLASSES);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((c) => c && typeof c.id === "string" && typeof c.name === "string");
  } catch {
    return [];
  }
}

function persistClasses() {
  localStorage.setItem(KEY_CLASSES, JSON.stringify(STATE.classes));
}

function poemsKey(classId) {
  return KEY_POEMS_PREFIX + classId;
}

function loadPoemsFor(classId) {
  if (!classId) return [];
  try {
    const raw = localStorage.getItem(poemsKey(classId));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((p) => p && Array.isArray(p.lines) && p.acrostic);
  } catch {
    return [];
  }
}

function persistPoemsFor(classId, poems) {
  if (!classId) return;
  localStorage.setItem(poemsKey(classId), JSON.stringify(poems));
}

function activeClass() {
  return STATE.classes.find((c) => c.id === STATE.activeId) || null;
}

function setActiveClass(id) {
  if (!STATE.classes.some((c) => c.id === id)) return;
  STATE.activeId = id;
  localStorage.setItem(KEY_ACTIVE, id);
  STATE.poems = loadPoemsFor(id);
  refreshAll();
}

function createClass(name, { note = "" } = {}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    toast("학급 이름을 적어주세요.", "error");
    return null;
  }
  if (trimmed.length > 30) {
    toast("학급 이름은 30자 이내로 적어주세요.", "error");
    return null;
  }
  if (STATE.classes.some((c) => c.name === trimmed)) {
    toast("같은 이름의 학급이 이미 있어요.", "error");
    return null;
  }
  const cls = {
    id: uid(),
    name: trimmed,
    note,
    createdAt: new Date().toISOString(),
  };
  STATE.classes.push(cls);
  persistClasses();
  setActiveClass(cls.id);
  return cls;
}

function renameClass(id, newName) {
  const trimmed = String(newName || "").trim();
  if (!trimmed) {
    toast("학급 이름을 적어주세요.", "error");
    return false;
  }
  if (STATE.classes.some((c) => c.id !== id && c.name === trimmed)) {
    toast("같은 이름의 학급이 이미 있어요.", "error");
    return false;
  }
  const cls = STATE.classes.find((c) => c.id === id);
  if (!cls) return false;
  cls.name = trimmed;
  persistClasses();
  refreshAll();
  return true;
}

function deleteClass(id) {
  const idx = STATE.classes.findIndex((c) => c.id === id);
  if (idx === -1) return;
  STATE.classes.splice(idx, 1);
  persistClasses();
  localStorage.removeItem(poemsKey(id));
  if (STATE.activeId === id) {
    const fallback = STATE.classes[0]?.id || null;
    if (fallback) {
      setActiveClass(fallback);
    } else {
      STATE.activeId = null;
      localStorage.removeItem(KEY_ACTIVE);
      STATE.poems = [];
      refreshAll();
    }
  } else {
    refreshAll();
  }
}

// 마이그레이션: 구버전(poems.v1) 단일 저장소를 "우리반" 학급으로 이관
function migrateLegacyIfNeeded() {
  if (STATE.classes.length > 0) return;
  const raw = localStorage.getItem(LEGACY_POEMS_KEY);
  if (!raw) return;
  let oldPoems = [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) oldPoems = data;
  } catch {
    return;
  }
  const cls = {
    id: uid(),
    name: "우리반",
    note: "이전 버전에서 자동으로 옮긴 학급",
    createdAt: new Date().toISOString(),
  };
  STATE.classes.push(cls);
  persistClasses();
  persistPoemsFor(cls.id, oldPoems);
  STATE.activeId = cls.id;
  localStorage.setItem(KEY_ACTIVE, cls.id);
  localStorage.removeItem(LEGACY_POEMS_KEY);
  if (oldPoems.length > 0) {
    setTimeout(() => toast(`이전 작품 ${oldPoems.length}편을 "우리반" 학급으로 옮겼어요.`, "success"), 200);
  }
}

// ---------- 작품 저장 (활성 학급 기준) ----------
function savePoems() {
  if (!STATE.activeId) return;
  try {
    persistPoemsFor(STATE.activeId, STATE.poems);
  } catch (e) {
    toast("저장 공간이 가득 찼어요. JSON으로 내보낸 뒤 일부를 삭제해 주세요.", "error");
    throw e;
  }
  syncToFolder();
}

async function syncToFolder() {
  if (!STATE.syncHandle) return;
  const cls = activeClass();
  if (!cls) return;
  try {
    const safe = cls.name.replace(/[\\\/:*?"<>|]/g, "_");
    const handle = await STATE.syncHandle.getFileHandle(
      `gallery-${safe}.json`,
      { create: true }
    );
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(STATE.poems, null, 2));
    await writable.close();
  } catch (e) {
    console.warn("폴더 동기화 실패", e);
    toast("폴더 동기화에 실패해 자동 미러를 껐어요.", "error");
    STATE.syncHandle = null;
    updateSyncToggle();
  }
}

// ---------- 입력 패널 ----------
function renderLines() {
  const acrosticInput = $("#acrostic");
  const linesEl = $("#lines");
  const chars = splitAcrostic(acrosticInput.value);
  const existing = $$(".line-row", linesEl);

  const prev = existing.map((row) => row.querySelector(".line-input").value);

  linesEl.innerHTML = "";
  chars.forEach((ch, i) => {
    const row = document.createElement("div");
    row.className = "line-row";
    row.innerHTML = `
      <div class="line-head" aria-hidden="true">${escapeHTML(ch)}</div>
      <input
        class="line-input"
        type="text"
        maxlength="60"
        autocomplete="off"
        aria-label="${escapeHTML(ch)}로 시작하는 줄"
        value="${escapeHTML(prev[i] || "")}"
      />
      <span class="line-meta" aria-live="polite">0자</span>
    `;
    linesEl.appendChild(row);
  });

  bindLineInputs();
  refreshSaveButton();
}

function bindLineInputs() {
  $$(".line-row").forEach((row) => {
    const input = row.querySelector(".line-input");
    const meta = row.querySelector(".line-meta");
    const update = () => {
      const n = syllableCount(input.value);
      meta.textContent = `${n}자`;
      refreshSaveButton();
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        $("#poem-form").requestSubmit();
      }
    });
    update();
  });
}

function refreshSaveButton() {
  const lines = currentLines();
  const someFilled = lines.some((l) => l.text.trim().length > 0);
  $("#save-btn").disabled = !someFilled || !STATE.activeId;
}

function currentLines() {
  return $$(".line-row").map((row) => ({
    head: row.querySelector(".line-head").textContent,
    text: row.querySelector(".line-input").value.trim(),
  }));
}

function resetForm({ keepAcrostic = false } = {}) {
  if (!keepAcrostic) $("#acrostic").value = "";
  $("#author").value = "";
  $("#lines").innerHTML = "";
  refreshSaveButton();
}

// ---------- 저장 / 갤러리 ----------
function addPoem({ acrostic, lines, author }) {
  if (!STATE.activeId) {
    toast("먼저 학급을 만들어 주세요.", "error");
    return null;
  }
  const poem = {
    id: uid(),
    acrostic,
    lines,
    author: author || "",
    createdAt: new Date().toISOString(),
  };
  STATE.poems.unshift(poem);
  savePoems();
  renderGallery();
  renderClassChip();
  return poem;
}

function deletePoem(id) {
  const idx = STATE.poems.findIndex((p) => p.id === id);
  if (idx === -1) return;
  STATE.poems.splice(idx, 1);
  savePoems();
  renderGallery();
  renderClassChip();
}

function renderGallery() {
  const gallery = $("#gallery");
  const empty = $("#gallery-empty");
  const count = $("#poem-count");

  count.textContent = `${STATE.poems.length}편`;
  gallery.innerHTML = "";

  if (!STATE.activeId) {
    empty.hidden = true;
    return;
  }
  if (STATE.poems.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  STATE.poems.forEach((p) => {
    const card = document.createElement("article");
    card.className = "poem-card";
    card.setAttribute("role", "listitem");
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="poem-actions">
        <button type="button" class="icon-btn" data-action="png"
          aria-label="이 작품을 이미지로 저장">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18-5.5 5.5 1.4 1.4L11 5.8V16h2V5.8l3.1 3.1 1.4-1.4L12 2z"/>
          </svg>
        </button>
        <button type="button" class="icon-btn danger" data-action="delete"
          aria-label="이 작품을 삭제">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
      <div class="poem-card-body">
        ${p.lines
          .map(
            (l) => `
              <div class="poem-line">
                <span class="head">${escapeHTML(l.head)}</span>
                <span class="rest">${escapeHTML(l.text || " ")}</span>
              </div>`
          )
          .join("")}
      </div>
      <footer class="poem-card-meta">
        <span class="author">${escapeHTML(p.author || "익명")}</span>
        <time datetime="${p.createdAt}">${formatDate(p.createdAt)}</time>
      </footer>
    `;
    card.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) {
        const idx = STATE.poems.findIndex((x) => x.id === p.id);
        openPresent(idx);
        return;
      }
      const action = btn.dataset.action;
      if (action === "delete") {
        if (confirm("이 작품을 삭제할까요? 되돌릴 수 없어요.")) {
          deletePoem(p.id);
        }
      } else if (action === "png") {
        exportCardPNG(card, p);
      }
    });
    gallery.appendChild(card);
  });
}

// ---------- 학급 칩 / 모달 렌더 ----------
function renderClassChip() {
  const chip = $("#class-chip");
  const cls = activeClass();
  if (!cls) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  $("#class-chip-name").textContent = cls.name;
  $("#class-chip-count").textContent = `${STATE.poems.length}편`;
  // gallery 제목 옆 학급 표시
  const galleryHelp = $("#gallery-help");
  if (galleryHelp) {
    galleryHelp.textContent = `${cls.name} 의 학기 시집에 작품이 쌓여요.`;
  }
}

function renderClassesModal() {
  const list = $("#class-list");
  list.innerHTML = "";
  if (STATE.classes.length === 0) {
    list.innerHTML = `<li class="class-row class-empty">아직 학급이 없어요.</li>`;
    return;
  }
  STATE.classes.forEach((c) => {
    const count = loadPoemsFor(c.id).length;
    const isActive = c.id === STATE.activeId;
    const row = document.createElement("li");
    row.className = "class-row" + (isActive ? " is-active" : "");
    row.innerHTML = `
      <div class="class-info">
        <div class="class-name">
          <span class="class-name-text">${escapeHTML(c.name)}</span>
          ${isActive ? '<span class="class-badge">사용중</span>' : ""}
        </div>
        <div class="class-meta">${count}편 · ${formatDate(c.createdAt)}</div>
      </div>
      <div class="class-row-actions">
        ${
          isActive
            ? ""
            : `<button type="button" class="btn btn-ghost btn-sm" data-act="switch" data-id="${c.id}">전환</button>`
        }
        <button type="button" class="btn btn-text btn-sm" data-act="rename" data-id="${c.id}">이름변경</button>
        <button type="button" class="btn btn-text btn-sm danger" data-act="delete" data-id="${c.id}">삭제</button>
      </div>
    `;
    list.appendChild(row);
  });
}

function openClassesModal() {
  renderClassesModal();
  $("#classes-modal").hidden = false;
  setTimeout(() => $("#new-class-input").focus(), 0);
}
function closeClassesModal() {
  $("#classes-modal").hidden = true;
}

// ---------- 환영 모달 (학급 0개) ----------
function openWelcome() {
  $("#welcome-modal").hidden = false;
  setTimeout(() => $("#welcome-class-input").focus(), 0);
  // body interactions disabled feel — gallery is empty anyway
}
function closeWelcome() {
  $("#welcome-modal").hidden = true;
}

// ---------- 전체 상태 동기화 ----------
function refreshAll() {
  renderClassChip();
  renderGallery();
  refreshSaveButton();
  // form 입력 가능 여부
  const hasClass = !!STATE.activeId;
  $("#acrostic").disabled = !hasClass;
  $("#author").disabled = !hasClass;
  $("#start-btn").disabled = !hasClass;
  $("#present-btn").disabled = !hasClass;
  $("#export-btn").disabled = !hasClass;
  // 환영 모달 자동 노출
  if (!hasClass) {
    openWelcome();
  } else {
    closeWelcome();
  }
}

// ---------- 발표 모드 ----------
function openPresent(startIndex = -1) {
  if (STATE.poems.length === 0) {
    renderPresentEmpty();
  } else {
    const idx =
      startIndex >= 0
        ? startIndex
        : Math.floor(Math.random() * STATE.poems.length);
    STATE.present.index = idx;
    renderPresent();
  }
  STATE.present.open = true;
  const dlg = $("#present");
  dlg.hidden = false;
  $("#present-close").focus();
  document.body.style.overflow = "hidden";
}

function closePresent() {
  $("#present").hidden = true;
  STATE.present.open = false;
  document.body.style.overflow = "";
  $("#present-btn").focus();
}

function renderPresent() {
  const p = STATE.poems[STATE.present.index];
  const card = $("#present-card");
  if (!p) {
    renderPresentEmpty();
    return;
  }
  const cls = activeClass();
  card.innerHTML = `
    <div class="present-body">
      ${p.lines
        .map(
          (l) => `
            <div class="poem-line">
              <span class="head">${escapeHTML(l.head)}</span>
              <span class="rest">${escapeHTML(l.text || " ")}</span>
            </div>`
        )
        .join("")}
    </div>
    <div class="present-author">— ${escapeHTML(p.author || "익명")} · ${escapeHTML(cls ? cls.name : "")} · ${formatDate(p.createdAt)}</div>
  `;
  $("#present-index").textContent = `${STATE.present.index + 1} / ${STATE.poems.length}`;
  $("#present-prev").disabled = STATE.poems.length <= 1;
  $("#present-next").disabled = STATE.poems.length <= 1;
}

function renderPresentEmpty() {
  $("#present-card").innerHTML = `
    <div class="present-empty">아직 작품이 없어요.<br/>왼쪽 보드에서 첫 시를 적어보세요.</div>
  `;
  $("#present-index").textContent = `0 / 0`;
  $("#present-prev").disabled = true;
  $("#present-next").disabled = true;
}

function presentMove(delta) {
  if (STATE.poems.length === 0) return;
  const n = STATE.poems.length;
  STATE.present.index = (STATE.present.index + delta + n) % n;
  renderPresent();
}

function presentShuffle() {
  if (STATE.poems.length === 0) return;
  if (STATE.poems.length === 1) {
    STATE.present.index = 0;
  } else {
    let next;
    do {
      next = Math.floor(Math.random() * STATE.poems.length);
    } while (next === STATE.present.index);
    STATE.present.index = next;
  }
  renderPresent();
}

// ---------- 카드 PNG 내보내기 ----------
async function exportCardPNG(cardEl, poem) {
  if (typeof window.html2canvas !== "function") {
    toast("이미지 저장 라이브러리를 불러오지 못했어요. 네트워크를 확인해 주세요.", "error");
    return;
  }
  const printable = document.createElement("div");
  printable.className = "offscreen";
  printable.innerHTML = `
    <div class="poem-card" style="width:420px;">
      <div class="poem-card-body">
        ${poem.lines
          .map(
            (l) => `
              <div class="poem-line">
                <span class="head">${escapeHTML(l.head)}</span>
                <span class="rest">${escapeHTML(l.text || " ")}</span>
              </div>`
          )
          .join("")}
      </div>
      <footer class="poem-card-meta">
        <span>${escapeHTML(poem.author || "익명")}</span>
        <time>${formatDate(poem.createdAt)}</time>
      </footer>
    </div>
  `;
  document.body.appendChild(printable);
  try {
    const canvas = await window.html2canvas(printable.firstElementChild, {
      backgroundColor: "#faf9f5",
      scale: 2,
    });
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(poem.acrostic || "시").replace(/[\\\/:*?"<>|]/g, "_")}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast("이미지를 저장했어요.", "success");
    });
  } catch (e) {
    console.error(e);
    toast("이미지 저장에 실패했어요.", "error");
  } finally {
    printable.remove();
  }
}

// ---------- PDF 시집 생성 ----------
async function exportSemesterPDF({ klass, title, foreword }) {
  if (typeof window.html2pdf !== "function") {
    toast("PDF 라이브러리를 불러오지 못했어요. 네트워크를 확인해 주세요.", "error");
    return;
  }
  if (STATE.poems.length === 0) {
    toast("아직 작품이 없어요.", "error");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "offscreen";

  const cover = document.createElement("div");
  cover.className = "pdf-page pdf-cover";
  cover.innerHTML = `
    <div class="pdf-cover-class">${escapeHTML(klass || "우리반")}</div>
    <h1 class="pdf-cover-title">${escapeHTML(title)}</h1>
    <div class="pdf-cover-meta">
      ${STATE.poems.length}편의 머리글자 시 · ${formatDate(new Date())}
    </div>
  `;
  wrap.appendChild(cover);

  const toc = document.createElement("div");
  toc.className = "pdf-page pdf-toc";
  toc.innerHTML = `
    <h3>차례</h3>
    <ol>
      ${STATE.poems
        .map(
          (p) => `
            <li>
              <span class="toc-title">${escapeHTML(p.acrostic)}</span>
              <span class="toc-author">${escapeHTML(p.author || "익명")}</span>
            </li>`
        )
        .join("")}
    </ol>
  `;
  wrap.appendChild(toc);

  STATE.poems.forEach((p, i) => {
    const page = document.createElement("div");
    page.className = "pdf-page pdf-poem-page";
    page.innerHTML = `
      <h4>${String(i + 1).padStart(2, "0")} / ${String(STATE.poems.length).padStart(2, "0")}</h4>
      <div class="pdf-poem-title">${escapeHTML(p.acrostic)}</div>
      <div>
        ${p.lines
          .map(
            (l) => `
              <div class="poem-line">
                <span class="head">${escapeHTML(l.head)}</span>
                <span class="rest">${escapeHTML(l.text || " ")}</span>
              </div>`
          )
          .join("")}
      </div>
      <div class="pdf-poem-author">— ${escapeHTML(p.author || "익명")} · ${formatDate(p.createdAt)}</div>
    `;
    wrap.appendChild(page);
  });

  if (foreword && foreword.trim()) {
    const after = document.createElement("div");
    after.className = "pdf-page pdf-afterword";
    after.innerHTML = `
      <h3>발문</h3>
      <p>${escapeHTML(foreword)}</p>
    `;
    wrap.appendChild(after);
  }

  document.body.appendChild(wrap);

  try {
    const filename = `${(title || "우리반 시집").replace(/[\\\/:*?"<>|]/g, "_")}.pdf`;
    await window
      .html2pdf()
      .set({
        margin: 0,
        filename,
        html2canvas: { scale: 2, backgroundColor: "#faf9f5" },
        jsPDF: { unit: "pt", format: [720, 1000], orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], before: ".pdf-page", avoid: ".poem-line" },
      })
      .from(wrap)
      .save();
    toast("시집 PDF를 다운로드했어요.", "success");
  } catch (e) {
    console.error(e);
    toast("PDF 만들기에 실패했어요.", "error");
  } finally {
    wrap.remove();
  }
}

// ---------- JSON 가져오기 / 내보내기 ----------
function exportJSON() {
  if (!STATE.activeId) return;
  const cls = activeClass();
  const payload = {
    exportedAt: new Date().toISOString(),
    class: cls ? { name: cls.name, note: cls.note || "" } : null,
    poems: STATE.poems,
  };
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = cls ? cls.name.replace(/[\\\/:*?"<>|]/g, "_") : "sijitgi-bodeu";
  a.href = url;
  a.download = `${safe}-${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("JSON 파일을 다운로드했어요.", "success");
}

async function importJSON(file) {
  if (!STATE.activeId) {
    toast("먼저 학급을 선택해 주세요.", "error");
    return;
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // 두 형식 지원: 옛 형식(배열) + 새 형식({ class, poems })
    let incoming;
    if (Array.isArray(parsed)) {
      incoming = parsed;
    } else if (parsed && Array.isArray(parsed.poems)) {
      incoming = parsed.poems;
    } else {
      throw new Error("형식이 맞지 않습니다");
    }
    const existing = new Set(STATE.poems.map((p) => p.id));
    let added = 0;
    for (const p of incoming) {
      if (
        !p ||
        typeof p.acrostic !== "string" ||
        !Array.isArray(p.lines)
      )
        continue;
      const poem = {
        id: typeof p.id === "string" ? p.id : uid(),
        acrostic: p.acrostic,
        lines: p.lines
          .map((l) => ({
            head: String(l.head ?? ""),
            text: String(l.text ?? ""),
          }))
          .filter((l) => l.head),
        author: typeof p.author === "string" ? p.author : "",
        createdAt:
          typeof p.createdAt === "string"
            ? p.createdAt
            : new Date().toISOString(),
      };
      if (poem.lines.length === 0) continue;
      if (existing.has(poem.id)) continue;
      STATE.poems.push(poem);
      existing.add(poem.id);
      added += 1;
    }
    STATE.poems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    savePoems();
    renderGallery();
    renderClassChip();
    toast(`${added}편 가져왔어요.`, "success");
  } catch (e) {
    console.error(e);
    toast("JSON 가져오기에 실패했어요. 파일 형식을 확인해 주세요.", "error");
  }
}

// ---------- 폴더 동기화 토글 ----------
const FS_SUPPORTED = typeof window.showDirectoryPicker === "function";

function updateSyncToggle() {
  const btn = $("#sync-toggle");
  if (!FS_SUPPORTED) {
    btn.disabled = true;
    btn.setAttribute(
      "title",
      "이 브라우저는 폴더 동기화를 지원하지 않아요 (Chromium 계열 브라우저에서 가능)"
    );
    return;
  }
  btn.setAttribute("aria-pressed", STATE.syncHandle ? "true" : "false");
  btn.querySelector("span:last-child").textContent = STATE.syncHandle
    ? "폴더 동기화 중"
    : "폴더 동기화";
}

async function toggleSync() {
  if (!FS_SUPPORTED) return;
  if (STATE.syncHandle) {
    STATE.syncHandle = null;
    updateSyncToggle();
    toast("폴더 동기화를 껐어요.");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: "sijitgi-bodeu",
      mode: "readwrite",
    });
    STATE.syncHandle = handle;
    updateSyncToggle();
    await syncToFolder();
    toast("폴더 동기화를 시작했어요.", "success");
  } catch (e) {
    if (e?.name === "AbortError") return;
    console.warn(e);
    toast("폴더 동기화에 실패했어요.", "error");
  }
}

// ---------- 내보내기 메뉴 / PDF 모달 ----------
function setMenuOpen(open) {
  const btn = $("#export-btn");
  const menu = $("#export-menu");
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function openPdfModal() {
  // prefill 학급명
  const cls = activeClass();
  if (cls) $("#pdf-class").value = cls.name;
  $("#pdf-modal").hidden = false;
  setTimeout(() => $("#pdf-title-input").focus(), 0);
}
function closePdfModal() {
  $("#pdf-modal").hidden = true;
}

// ---------- 이벤트 바인딩 ----------
function bind() {
  // 머리글자 입력
  $("#acrostic").addEventListener("input", renderLines);
  $("#acrostic").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#start-btn").click();
    }
  });
  $("#start-btn").addEventListener("click", () => {
    renderLines();
    const first = $(".line-input");
    if (first) first.focus();
    else $("#acrostic").focus();
  });
  $("#clear-btn").addEventListener("click", () => {
    resetForm();
    $("#acrostic").focus();
  });

  // 저장
  $("#poem-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!STATE.activeId) {
      toast("먼저 학급을 만들어 주세요.", "error");
      return;
    }
    const acrostic = $("#acrostic").value.trim();
    const author = $("#author").value.trim();
    const lines = currentLines();
    if (!acrostic || lines.length === 0) {
      toast("머리글자 단어를 적어주세요.", "error");
      return;
    }
    if (!lines.some((l) => l.text.length > 0)) {
      toast("적어도 한 줄은 채워주세요.", "error");
      return;
    }
    addPoem({ acrostic, lines, author });
    resetForm();
    toast("갤러리에 저장했어요.", "success");
  });

  // 발표 모드
  $("#present-btn").addEventListener("click", () => openPresent());
  $("#present-close").addEventListener("click", closePresent);
  $("#present-prev").addEventListener("click", () => presentMove(-1));
  $("#present-next").addEventListener("click", () => presentMove(1));
  $("#present-shuffle").addEventListener("click", presentShuffle);

  // 키보드
  document.addEventListener("keydown", (e) => {
    if (STATE.present.open) {
      if (e.key === "Escape") {
        closePresent();
      } else if (e.key === "ArrowLeft") {
        presentMove(-1);
      } else if (e.key === "ArrowRight" || e.key === " ") {
        if (e.target.tagName !== "BUTTON") e.preventDefault();
        presentMove(1);
      }
      return;
    }
    if (
      document.activeElement &&
      ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
    )
      return;
    if (e.key === "r" || e.key === "R") {
      if (STATE.activeId) openPresent();
    }
  });

  // 내보내기 메뉴
  $("#export-btn").addEventListener("click", () => {
    if (!STATE.activeId) return;
    const open = $("#export-menu").hidden;
    setMenuOpen(open);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) setMenuOpen(false);
  });
  $$("#export-menu [role='menuitem']").forEach((item) => {
    item.addEventListener("click", () => {
      setMenuOpen(false);
      const action = item.dataset.action;
      if (action === "pdf") openPdfModal();
      else if (action === "export-json") exportJSON();
      else if (action === "import-json") $("#import-file").click();
    });
  });

  // JSON 파일 선택
  $("#import-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importJSON(file);
    e.target.value = "";
  });

  // PDF 모달
  $("#pdf-modal").addEventListener("click", (e) => {
    if (e.target.matches("[data-close-modal]") || e.target === $("#pdf-modal")) {
      closePdfModal();
    }
  });
  $("#pdf-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      klass: $("#pdf-class").value.trim(),
      title: $("#pdf-title-input").value.trim() || "우리반 시집",
      foreword: $("#pdf-foreword").value.trim(),
    };
    closePdfModal();
    await exportSemesterPDF(data);
  });

  // 폴더 동기화
  $("#sync-toggle").addEventListener("click", toggleSync);

  // 학급 칩 → 학급 관리 모달
  $("#class-chip").addEventListener("click", openClassesModal);
  $("#classes-modal").addEventListener("click", (e) => {
    if (e.target.matches("[data-close-modal]") || e.target === $("#classes-modal")) {
      closeClassesModal();
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === "switch") {
      setActiveClass(id);
      renderClassesModal();
    } else if (act === "rename") {
      const cur = STATE.classes.find((c) => c.id === id);
      if (!cur) return;
      const next = prompt("새 학급 이름을 적어주세요.", cur.name);
      if (next === null) return;
      if (renameClass(id, next)) {
        renderClassesModal();
      }
    } else if (act === "delete") {
      const cur = STATE.classes.find((c) => c.id === id);
      if (!cur) return;
      const count = loadPoemsFor(id).length;
      const msg =
        count > 0
          ? `"${cur.name}" 학급과 그 안의 ${count}편 작품을 모두 삭제해요. 되돌릴 수 없어요.`
          : `"${cur.name}" 학급을 삭제해요.`;
      if (confirm(msg)) {
        deleteClass(id);
        renderClassesModal();
      }
    }
  });
  $("#new-class-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#new-class-input");
    const cls = createClass(input.value);
    if (cls) {
      input.value = "";
      renderClassesModal();
      toast(`"${cls.name}" 학급을 만들었어요.`, "success");
    }
  });

  // 환영 모달
  $("#welcome-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#welcome-class-input");
    const cls = createClass(input.value);
    if (cls) {
      input.value = "";
      toast(`"${cls.name}" 학급으로 시작해요.`, "success");
    }
  });
}

// ---------- 초기화 ----------
function init() {
  STATE.classes = loadClasses();
  migrateLegacyIfNeeded();
  const savedActive = localStorage.getItem(KEY_ACTIVE);
  if (savedActive && STATE.classes.some((c) => c.id === savedActive)) {
    STATE.activeId = savedActive;
  } else if (STATE.classes.length > 0) {
    STATE.activeId = STATE.classes[0].id;
    localStorage.setItem(KEY_ACTIVE, STATE.activeId);
  } else {
    STATE.activeId = null;
  }
  STATE.poems = loadPoemsFor(STATE.activeId);

  bind();
  refreshAll();
  updateSyncToggle();

  if (STATE.activeId) $("#acrostic").focus();

  window.__app = {
    state: STATE,
    addPoem,
    renderGallery,
    openPresent,
    closePresent,
    exportJSON,
    importJSON,
    createClass,
    setActiveClass,
    deleteClass,
    loadPoemsFor,
    activeClass,
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
