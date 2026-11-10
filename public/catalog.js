// แคตตาล็อกสินค้า (E-Catalog): flip-book reader for the PDFs listed in src/config/catalogs.js.
// pdf.js 3.11.174 is served same-origin from /vendor/pdfjs (npm pdfjs-dist, pinned).
(() => {
  const $ = (id) => document.getElementById(id);
  const tabsEl = $("ecat-tabs"),
    viewer = $("ecat-viewer"),
    stage = $("ecat-stage"),
    book = $("ecat-book"),
    stateEl = $("ecat-state"),
    titleEl = $("ecat-book-title"),
    counterEl = $("ecat-counter"),
    prevBtn = $("ecat-prev"),
    nextBtn = $("ecat-next"),
    slider = $("ecat-slider"),
    thumbsEl = $("ecat-thumbs"),
    zoomOut = $("ecat-zoom-out"),
    zoomIn = $("ecat-zoom-in"),
    zoomValue = $("ecat-zoom-value"),
    fullBtn = $("ecat-fullscreen"),
    downloadLink = $("ecat-download"),
    toast = $("ecat-toast");
  const leftSlot = book.querySelector(".ecat-page-left"),
    rightSlot = book.querySelector(".ecat-page-right"),
    leaf = book.querySelector(".ecat-leaf"),
    leafFront = leaf.querySelector(".ecat-face-front canvas"),
    leafBack = leaf.querySelector(".ecat-face-back canvas"),
    cornerPrev = book.querySelector(".ecat-corner-prev"),
    cornerNext = book.querySelector(".ecat-corner-next");

  const SINGLE_QUERY = window.matchMedia("(max-width: 759.98px)");
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ZOOM_MIN = 100,
    ZOOM_MAX = 250,
    ZOOM_STEP = 25,
    TURN_MS = 720,
    MAX_RENDER_PX = 3200,
    CACHE_LIMIT = 24;

  let catalogs = [];
  let current = null; // the selected catalog entry
  let doc = null;
  let loadingTask = null;
  let loadToken = 0;
  let aspect = 1.414; // page height / width, from page 1
  let pickedSingle = false; // the 1/2-page control; every opened book starts at 2 pages
  const wantsSingle = () => SINGLE_QUERY.matches || pickedSingle; // phones have no room for 2 pages
  const viewButtons = [...document.querySelectorAll("#ecat-view button")];
  let single = wantsSingle();
  let spreads = [];
  let index = 0;
  let zoom = 100;
  let pageW = 0,
    pageH = 0;
  let turning = false;
  let sections = []; // [{ title, page }] category drop-down of the open book
  let queued = null;
  const renderCache = new Map(); // `${page}@${px}` -> Promise<canvas>
  const thumbCache = new Map();

  // ---------- helpers ----------
  const errorText = (error) =>
    error?.name === "MissingPDFException" || error?.status === 404
      ? "ไม่พบไฟล์ PDF บนเซิร์ฟเวอร์ กรุณาแจ้งผู้ดูแลระบบให้วางไฟล์ไว้ในโฟลเดอร์แคตตาล็อก"
      : error?.name === "InvalidPDFException"
        ? "ไฟล์ไม่ใช่ PDF ที่ถูกต้อง หรือไฟล์เสียหาย"
        : error?.status === 502
          ? "ดึงไฟล์จาก Google Drive ไม่สำเร็จ ตรวจว่าแชร์ไฟล์เป็น \"ทุกคนที่มีลิงก์\" แล้วลองใหม่"
          : error?.status === 403
          ? "บัญชีนี้ไม่มีสิทธิ์ดูแคตตาล็อก"
          : "เกิดข้อผิดพลาดระหว่างโหลดไฟล์ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่";

  function showState(kind, title, message, retry) {
    stateEl.hidden = false;
    stateEl.className = "ecat-state" + (kind === "error" ? " is-error" : "");
    stateEl.setAttribute("role", kind === "error" ? "alert" : "status");
    stateEl.replaceChildren();
    if (kind === "loading") {
      const spinner = document.createElement("span");
      spinner.className = "ecat-spinner";
      spinner.setAttribute("aria-hidden", "true");
      stateEl.append(spinner);
    }
    const strong = document.createElement("strong");
    strong.textContent = title;
    stateEl.append(strong);
    if (message) {
      const p = document.createElement("p");
      p.textContent = message;
      stateEl.append(p);
    }
    if (kind === "loading") {
      const bar = document.createElement("div");
      bar.className = "ecat-progress";
      bar.append(document.createElement("i"));
      stateEl.append(bar);
    }
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "ลองอีกครั้ง";
      button.addEventListener("click", retry);
      stateEl.append(button);
    }
    book.hidden = true;
  }
  function setProgress(ratio) {
    const bar = stateEl.querySelector(".ecat-progress i");
    if (bar) bar.style.width = Math.round(Math.min(1, Math.max(0, ratio)) * 100) + "%";
  }
  let toastTimer;
  // action = { label, run } adds a button to the toast and keeps it up longer.
  function showToast(text, action) {
    toast.textContent = text;
    toast.classList.toggle("has-action", Boolean(action));
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        toast.classList.remove("is-visible");
        action.run();
      });
      toast.append(button);
    }
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), action ? 10000 : 2200);
  }
  function setControlsEnabled(enabled) {
    slider.disabled = !enabled;
    searchInput.disabled = !enabled;
    zoomIn.disabled = !enabled || zoom >= ZOOM_MAX;
    zoomOut.disabled = !enabled || zoom <= ZOOM_MIN;
    if (!enabled) prevBtn.disabled = nextBtn.disabled = true;
  }

  // ---------- spreads ----------
  // Double: cover alone on the right, then 2-3, 4-5 … Single: one page each.
  function buildSpreads(total) {
    const list = [];
    if (single) for (let p = 1; p <= total; p++) list.push({ left: null, right: p });
    else {
      list.push({ left: null, right: 1 });
      for (let p = 2; p <= total; p += 2) list.push({ left: p, right: p + 1 <= total ? p + 1 : null });
    }
    return list;
  }
  const firstPage = (s) => s.left ?? s.right;
  const spreadOfPage = (page) => Math.max(0, spreads.findIndex((s) => s.left === page || s.right === page));
  const spreadLabel = (s) => (s.left && s.right ? `${s.left}–${s.right}` : String(firstPage(s)));

  // ---------- rendering ----------
  function renderPage(page, px) {
    const key = `${page}@${px}`;
    if (renderCache.has(key)) {
      const hit = renderCache.get(key);
      renderCache.delete(key); // LRU: move to the end
      renderCache.set(key, hit);
      return hit;
    }
    const pdf = doc;
    const job = pdf.getPage(page).then(async (p) => {
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: px / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await p.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
      return canvas;
    });
    job.catch(() => renderCache.delete(key));
    renderCache.set(key, job);
    while (renderCache.size > CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value);
    return job;
  }
  const renderPx = () => Math.min(MAX_RENDER_PX, Math.round(pageW * (window.devicePixelRatio || 1)));

  async function paint(canvas, page) {
    const slot = canvas.closest(".ecat-page");
    if (!page) {
      slot?.classList.add("is-empty");
      canvas.removeAttribute("aria-label");
      return;
    }
    slot?.classList.remove("is-empty");
    canvas.setAttribute("aria-label", `หน้า ${page}`);
    const token = loadToken;
    try {
      const source = await renderPage(page, renderPx());
      if (token !== loadToken) return;
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
    } catch (error) {
      if (token === loadToken) console.warn("Render failed", page, error?.name);
    }
  }
  function prefetch() {
    const px = renderPx();
    for (const i of [index + 1, index - 1, index + 2]) {
      const s = spreads[i];
      if (!s) continue;
      for (const page of [s.left, s.right]) if (page) renderPage(page, px).catch(() => {});
    }
  }

  // ---------- layout ----------
  function layout() {
    if (!doc) return;
    const style = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const cols = single ? 1 : 2;
    const fitW = Math.max(80, Math.floor(Math.min(availW / cols, availH / aspect)));
    pageW = Math.round((fitW * zoom) / 100);
    pageH = Math.round(pageW * aspect);
    book.style.width = pageW * cols + "px";
    book.style.height = pageH + "px";
    book.classList.toggle("is-single", single);
  }
  async function show() {
    const s = spreads[index];
    if (!s) return;
    await Promise.all([paint(leftSlot.querySelector("canvas"), s.left), paint(rightSlot.querySelector("canvas"), s.right)]);
    prefetch();
  }

  // ---------- UI state ----------
  function updateUi() {
    const s = spreads[index];
    const total = doc?.numPages || 0;
    counterEl.textContent = s ? `หน้า ${spreadLabel(s)} / ${total}` : "";
    // A lone page (front cover, or a last page on the left) slides to the centre; it slides back while turning.
    book.classList.toggle("is-alone-right", Boolean(s && !single && !s.left));
    book.classList.toggle("is-alone-left", Boolean(s && !single && s.left && !s.right));
    prevBtn.disabled = !doc || index <= 0;
    nextBtn.disabled = !doc || index >= spreads.length - 1;
    cornerPrev.hidden = prevBtn.disabled;
    cornerNext.hidden = nextBtn.disabled;
    slider.max = String(Math.max(0, spreads.length - 1));
    slider.value = String(index);
    slider.setAttribute("aria-valuetext", s ? `หน้า ${spreadLabel(s)} จาก ${total}` : "");
    zoomValue.textContent = zoom + "%";
    viewButtons.forEach((b) => {
      b.disabled = !doc;
      b.setAttribute("aria-pressed", String((b.dataset.view === "1") === pickedSingle));
    });
    syncSectionSelect();
    stage.classList.toggle("is-zoomed", zoom > ZOOM_MIN);
    zoomIn.disabled = !doc || zoom >= ZOOM_MAX;
    zoomOut.disabled = !doc || zoom <= ZOOM_MIN;
    thumbsEl.querySelectorAll(".ecat-thumb").forEach((t, i) => {
      if (i === index) t.setAttribute("aria-current", "true");
      else t.removeAttribute("aria-current");
    });
    const active = thumbsEl.children[index];
    if (active) {
      // Scroll the strip only (scrollIntoView would also scroll the page).
      const left = active.offsetLeft - (thumbsEl.clientWidth - active.offsetWidth) / 2;
      thumbsEl.scrollTo({ left: Math.max(0, left) });
    }
  }

  // ---------- turning ----------
  function go(target) {
    if (!doc) return;
    target = Math.max(0, Math.min(spreads.length - 1, target));
    if (target === index) return;
    if (turning) {
      queued = target;
      return;
    }
    turn(target);
  }
  async function turn(target) {
    const from = spreads[index],
      to = spreads[target];
    const forward = target > index;
    if (REDUCED_MOTION.matches || document.hidden) {
      index = target;
      updateUi();
      await show();
      return;
    }
    turning = true;
    book.classList.add("is-turning");
    const token = loadToken;
    const leftCanvas = leftSlot.querySelector("canvas"),
      rightCanvas = rightSlot.querySelector("canvas");
    let front, back, baseLeft, baseRight;
    if (single) {
      // One page, spine on its left edge: the leaf swings up and away to reveal the next page (forward),
      // or swings back down over the current page (backward). It never passes 90°, so no back face.
      front = forward ? from.right : to.right;
      back = null;
      baseLeft = null;
      baseRight = forward ? to.right : from.right;
    } else if (forward) {
      front = from.right;
      back = to.left;
      baseLeft = from.left;
      baseRight = to.right;
    } else {
      front = from.left;
      back = to.right;
      baseLeft = to.left;
      baseRight = from.right;
    }
    // Paint the leaf first (it covers the base), then swap what lies underneath.
    await Promise.all([paint(leafFront, front), paint(leafBack, back)]);
    if (token !== loadToken) return finishTurn();
    const singleBack = single && !forward;
    leaf.className = "ecat-leaf " + (forward || single ? "is-forward" : "is-backward") + (singleBack ? " is-returning" : "");
    leaf.style.setProperty("--ecat-turn", TURN_MS + "ms");
    book.style.setProperty("--ecat-turn", TURN_MS + "ms");
    leaf.style.transform = singleBack ? "rotateY(-90deg)" : "rotateY(0deg)";
    leaf.hidden = false;
    await Promise.all([paint(leftCanvas, baseLeft), paint(rightCanvas, baseRight)]);
    if (token !== loadToken) return finishTurn();
    index = target;
    updateUi();
    void leaf.offsetWidth; // commit the start position before animating
    leaf.classList.add("is-turning");
    // Double: right leaf 0 → -180 (forward) or left leaf 0 → 180 (backward). Single: 0 → -90 / -90 → 0.
    const end = single ? (forward ? -90 : 0) : forward ? -180 : 180;
    leaf.style.transform = `rotateY(${end}deg)`;
    await new Promise((resolve) => {
      const done = () => {
        leaf.removeEventListener("transitionend", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, TURN_MS + 200);
      leaf.addEventListener("transitionend", done);
    });
    if (token === loadToken) await show();
    finishTurn();
  }
  function finishTurn() {
    leaf.hidden = true;
    leaf.className = "ecat-leaf";
    leaf.style.transform = "";
    book.classList.remove("is-turning");
    turning = false;
    if (queued !== null) {
      const next = queued;
      queued = null;
      if (next !== index) turn(next);
    }
  }

  // ---------- thumbnails ----------
  let thumbObserver;
  function buildThumbs() {
    thumbObserver?.disconnect();
    thumbsEl.replaceChildren();
    const token = loadToken;
    thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          thumbObserver.unobserve(entry.target);
          entry.target.querySelectorAll("canvas[data-page]").forEach((canvas) => paintThumb(canvas, Number(canvas.dataset.page), token));
        }
      },
      { root: thumbsEl, rootMargin: "0px 400px" },
    );
    spreads.forEach((s, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ecat-thumb";
      button.setAttribute("aria-label", `ไปหน้า ${spreadLabel(s)}`);
      const pages = document.createElement("span");
      pages.className = "ecat-thumb-pages";
      for (const page of [s.left, s.right]) {
        if (!page) continue;
        const canvas = document.createElement("canvas");
        canvas.dataset.page = String(page);
        canvas.width = 60;
        canvas.height = 84;
        pages.append(canvas);
      }
      const label = document.createElement("span");
      label.textContent = spreadLabel(s);
      button.append(pages, label);
      button.addEventListener("click", () => go(i));
      thumbsEl.append(button);
      thumbObserver.observe(button);
    });
  }
  async function paintThumb(canvas, page, token) {
    const px = Math.round(60 * Math.min(2, window.devicePixelRatio || 1));
    try {
      let job = thumbCache.get(page);
      if (!job) {
        job = renderPage(page, px);
        thumbCache.set(page, job);
      }
      const source = await job;
      if (token !== loadToken) return;
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
    } catch {
      thumbCache.delete(page);
    }
  }

  // ---------- loading a book ----------
  async function openCatalog(entry, startPage = 1) {
    current = entry;
    const token = ++loadToken;
    turning = false;
    queued = null;
    leaf.hidden = true;
    book.classList.remove("is-turning");
    renderCache.clear();
    thumbCache.clear();
    thumbObserver?.disconnect();
    thumbsEl.replaceChildren();
    const oldTask = loadingTask;
    loadingTask = null;
    doc = null;
    oldTask?.destroy().catch(() => {});
    spreads = [];
    index = 0;
    zoom = 100;
    tabsEl.querySelectorAll("[role=tab]").forEach((tab) => {
      const selected = tab.dataset.id === entry.id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    titleEl.textContent = entry.title;
    syncManage();
    sections = [];
    renderSections();
    searchInput.value = "";
    searchResults.replaceChildren();
    openResults(false);
    counterEl.textContent = "";
    downloadLink.href = entry.pdf + "?download=1";
    downloadLink.removeAttribute("aria-disabled");
    downloadLink.setAttribute("download", entry.pdf.split("/").pop());
    setControlsEnabled(false);
    updateUi();
    if (!entry.available) {
      downloadLink.setAttribute("aria-disabled", "true");
      showState("error", "เปิดแคตตาล็อกนี้ไม่ได้", "ยังไม่มีไฟล์ PDF ของเล่มนี้บนเซิร์ฟเวอร์ กรุณาแจ้งผู้ดูแลระบบ", () => openCatalog(entry));
      return;
    }
    if (!window.pdfjsLib) {
      showState("error", "เปิดแคตตาล็อกนี้ไม่ได้", "โหลดตัวอ่าน PDF ไม่สำเร็จ กรุณารีเฟรชหน้า", () => location.reload());
      return;
    }
    showState("loading", "กำลังเปิดแคตตาล็อก…", entry.title);
    // หน้าโหลด overlay (catalog-loader.js); starting a new one cancels the previous book's.
    const loader = window.ecatLoader?.start(entry.title);
    const live = () => token === loadToken;
    try {
      const cached = await readCachedPdf(entry);
      if (token !== loadToken) return;
      const task = pdfjsLib.getDocument({
        ...(cached ? { data: cached } : { url: entry.pdf }),
        cMapUrl: "/vendor/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
        isEvalSupported: false, // CVE-2024-4367: never compile font code from the PDF
        enableXfa: false,
      });
      loadingTask = task;
      task.onProgress = ({ loaded, total }) => {
        if (token === loadToken && total) {
          setProgress(loaded / total);
          loader?.progress(loaded / total);
        }
      };
      const pdf = await task.promise;
      if (token !== loadToken) return;
      loader?.prepared(pdf.numPages);
      doc = pdf;
      const first = await pdf.getPage(1);
      if (token !== loadToken) return;
      const vp = first.getViewport({ scale: 1 });
      aspect = vp.height / vp.width;
      pickedSingle = false;
      single = wantsSingle();
      spreads = buildSpreads(pdf.numPages);
      index = spreadOfPage(Math.min(pdf.numPages, Math.max(1, startPage))); // shared link to a page: #<id>/<page>
      stateEl.hidden = true;
      book.hidden = false;
      layout();
      buildThumbs();
      setControlsEnabled(true);
      updateUi();
      loadSections(entry, token);
      await show();
      if (live()) loader?.done();
      if (!cached) storeCachedPdf(entry, pdf);
    } catch (error) {
      if (token !== loadToken) return;
      loader?.fail(errorText(error));
      doc = null;
      showState("error", "เปิดแคตตาล็อกนี้ไม่ได้", errorText(error), () => openCatalog(entry));
      setControlsEnabled(false);
      updateUi();
    }
  }

  // ---------- browser PDF cache: open a book again without downloading it, until the server file changes ----------
  const PDF_CACHE = "ecat-pdf-v1";
  const cacheKey = (entry) => `${entry.pdf}?v=${entry.version}`;
  async function readCachedPdf(entry) {
    if (!entry.version || !window.caches) return null;
    try {
      const hit = await (await caches.open(PDF_CACHE)).match(cacheKey(entry));
      return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
    } catch { return null; }
  }
  async function storeCachedPdf(entry, pdf) {
    if (!entry.version || !window.caches) return;
    try {
      const cache = await caches.open(PDF_CACHE);
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname === entry.pdf) await cache.delete(req); // drop older versions of this book
      }
      const bytes = await pdf.getData();
      await cache.put(cacheKey(entry), new Response(bytes, { headers: { "Content-Type": "application/pdf" } }));
    } catch { /* quota / private mode: just download next time */ }
  }

  // ---------- re-layout (resize, zoom, single/double switch) ----------
  let relayoutTimer;
  function relayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => {
      if (!doc) return;
      if (turning) return relayout(); // never rebuild spreads mid-turn
      const nowSingle = wantsSingle();
      if (nowSingle !== single) {
        const page = firstPage(spreads[index]) || 1;
        single = nowSingle;
        spreads = buildSpreads(doc.numPages);
        index = spreadOfPage(page);
        buildThumbs();
      }
      layout();
      show();
      updateUi();
    }, 120);
  }
  new ResizeObserver(relayout).observe(stage);
  SINGLE_QUERY.addEventListener("change", relayout);
  viewButtons.forEach((b) =>
    b.addEventListener("click", () => {
      pickedSingle = b.dataset.view === "1";
      updateUi();
      relayout();
    }),
  );

  function setZoom(value) {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
    if (next === zoom || !doc) return;
    // Keep the same point of the book under the stage centre.
    const cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth);
    const cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight);
    zoom = next;
    layout();
    stage.scrollLeft = cx * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = cy * stage.scrollHeight - stage.clientHeight / 2;
    updateUi();
    show();
  }

  // ---------- controls ----------
  prevBtn.addEventListener("click", () => go(index - 1));
  nextBtn.addEventListener("click", () => go(index + 1));
  cornerPrev.addEventListener("click", () => go(index - 1));
  cornerNext.addEventListener("click", () => go(index + 1));
  slider.addEventListener("input", () => {
    const s = spreads[Number(slider.value)];
    if (s) counterEl.textContent = `หน้า ${spreadLabel(s)} / ${doc?.numPages || 0}`;
  });
  slider.addEventListener("change", () => go(Number(slider.value)));
  zoomIn.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
  zoomOut.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest?.("input, select, textarea, [contenteditable], dialog, .workspace-sidebar")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "Escape" && viewer.classList.contains("is-pseudo-fullscreen")) {
      setPseudoFullscreen(false);
    }
  });

  // Pan: when zoomed in, drag the page with the mouse (touch already scrolls natively).
  let pan = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || zoom === ZOOM_MIN || !doc) return;
    if (stage.scrollWidth <= stage.clientWidth && stage.scrollHeight <= stage.clientHeight) return;
    pan = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
    event.preventDefault(); // no text/image selection while dragging
  });
  window.addEventListener("pointermove", (event) => {
    if (!pan) return;
    const dx = event.clientX - pan.x,
      dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    stage.classList.add("is-panning");
    stage.scrollLeft = pan.left - dx;
    stage.scrollTop = pan.top - dy;
  });
  window.addEventListener("pointerup", () => {
    if (!pan) return;
    // A real drag must not also "click" a page corner and turn the page.
    if (pan.moved) stage.addEventListener("click", (e) => (e.stopPropagation(), e.preventDefault()), { capture: true, once: true });
    pan = null;
    stage.classList.remove("is-panning");
  });

  // Swipe (touch/pen). Only at 100% — when zoomed, dragging pans the page instead.
  let swipe = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || zoom !== ZOOM_MIN || !doc) return;
    swipe = { x: event.clientX, y: event.clientY, t: Date.now() };
  });
  stage.addEventListener("pointerup", (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x,
      dy = event.clientY - swipe.y,
      dt = Date.now() - swipe.t;
    swipe = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 900) go(index + (dx < 0 ? 1 : -1));
  });
  stage.addEventListener("pointercancel", () => (swipe = null));

  // Fullscreen: the real API where available, a fixed overlay otherwise (iPhone Safari).
  function setPseudoFullscreen(on) {
    viewer.classList.toggle("is-pseudo-fullscreen", on);
    document.documentElement.style.overflow = on ? "hidden" : "";
    syncFullscreenButton();
    relayout();
  }
  function syncFullscreenButton() {
    const on = document.fullscreenElement === viewer || viewer.classList.contains("is-pseudo-fullscreen");
    fullBtn.setAttribute("aria-pressed", String(on));
    fullBtn.querySelector("span").textContent = on ? "ออกจากเต็มจอ" : "เต็มจอ";
    fullBtn.title = on ? "ออกจากเต็มจอ" : "เต็มจอ";
  }
  fullBtn.addEventListener("click", async () => {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    if (viewer.classList.contains("is-pseudo-fullscreen")) return setPseudoFullscreen(false);
    if (viewer.requestFullscreen && document.fullscreenEnabled) {
      try {
        await viewer.requestFullscreen();
        return;
      } catch {}
    }
    setPseudoFullscreen(true);
  });
  document.addEventListener("fullscreenchange", () => {
    syncFullscreenButton();
    relayout();
  });

  // ---------- "แชร์หน้านี้": pick left / right / both -> save or share those pages as one PNG image ----------
  const shareBtn = $("ecat-share"),
    shareMenu = $("ecat-share-menu");
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {}
      area.remove();
      return ok;
    }
  }
  function openShareMenu(open) {
    shareMenu.hidden = !open;
    shareBtn.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const s = spreads[index] || {};
    const items = {
      left: s.left && (single ? null : "หน้าซ้าย · หน้า " + s.left),
      right: s.right && (single ? "หน้านี้ · หน้า " + s.right : "หน้าขวา · หน้า " + s.right),
      both: s.left && s.right && !single ? "ทั้งสองหน้า · หน้า " + s.left + "–" + s.right : null,
    };
    for (const button of shareMenu.querySelectorAll("[data-pages]")) {
      const key = button.dataset.pages;
      button.hidden = !items[key];
      button.textContent = items[key] || "";
    }
    shareMenu.querySelector("button:not([hidden])")?.focus();
  }
  shareBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (current && doc) openShareMenu(shareMenu.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".ecat-share")) openShareMenu(false);
  });
  shareMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      openShareMenu(false);
      shareBtn.focus();
    }
  });
  shareMenu.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pages]");
    if (!button || !current) return;
    openShareMenu(false);
    const s = spreads[index] || {};
    const from = button.dataset.pages === "right" ? s.right : s.left,
      to = button.dataset.pages === "left" ? s.left : s.right;
    const range = from === to ? String(from) : from + "-" + to;
    showToast("กำลังสร้างภาพหน้า " + range.replace("-", "–") + "…");
    const rendering = renderPagesImage(from === to ? [from] : [from, to]);
    // Clipboard must be requested inside the click (before any await), so hand it the pending image.
    const coarse = matchMedia("(pointer: coarse)").matches;
    const clip = coarse || !window.ClipboardItem || !navigator.clipboard?.write
      ? Promise.resolve(false)
      : navigator.clipboard.write([new ClipboardItem({ "image/png": rendering })]).then(() => true, (e) => (console.warn("clipboard", e), false));
    try {
      const blob = await rendering;
      const file = new File([blob], (current.id || "catalog") + "-p" + range + ".png", { type: "image/png" });
      // Phones/tablets: share sheet (LINE, Photos …). Desktop: the Windows share sheet is unreliable,
      // so copy the image to the clipboard (Ctrl+V into LINE).
      if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: current.title + " หน้า " + range });
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
      // Desktop: copy only. Download the PNG only when the clipboard is unavailable (e.g. plain http on a LAN IP).
      if (await clip) {
        // "แชร์ไปหาลูกค้า": a fresh click, so the share sheet gets user activation (the render already finished).
        const shareData = { files: [file], title: current.title + " หน้า " + range };
        const canShareFile = navigator.canShare?.(shareData);
        showToast(
          "คัดลอกภาพหน้า " + range.replace("-", "–") + " แล้ว · กด Ctrl+V วางใน LINE ได้เลย",
          canShareFile && {
            label: "แชร์ไปหาลูกค้า",
            run: () => navigator.share(shareData).catch((error) => {
              if (error?.name !== "AbortError") showToast("เปิดหน้าแชร์ไม่สำเร็จ · ใช้ Ctrl+V วางแทนได้");
            }),
          },
        );
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      showToast("คัดลอกภาพไม่ได้ในเบราว์เซอร์นี้ จึงบันทึกเป็นไฟล์แทน");
    } catch (error) {
      showToast("สร้างภาพไม่สำเร็จ: " + (error?.message || error));
    }
  });
  // Render 1–2 PDF pages side by side into one PNG (~2000px tall for sharp text).
  async function renderPagesImage(pageNumbers) {
    const pages = await Promise.all(pageNumbers.map((n) => doc.getPage(n)));
    const base = pages.map((p) => p.getViewport({ scale: 1 }));
    const scale = Math.min(3, 2000 / Math.max(...base.map((v) => v.height)));
    const views = pages.map((p) => p.getViewport({ scale }));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(views.reduce((w, v) => w + v.width, 0));
    canvas.height = Math.ceil(Math.max(...views.map((v) => v.height)));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let x = 0;
    for (const [i, page] of pages.entries()) {
      const part = document.createElement("canvas");
      part.width = Math.ceil(views[i].width);
      part.height = Math.ceil(views[i].height);
      await page.render({ canvasContext: part.getContext("2d"), viewport: views[i] }).promise;
      ctx.drawImage(part, x, 0);
      x += part.width;
    }
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
  }

  // ---------- tabs + hash ----------
  function selectFromHash() {
    let raw = "";
    try {
      raw = decodeURIComponent(location.hash.slice(1));
    } catch {}
    const [id, pageText] = raw.split("/");
    const page = Number.parseInt(pageText, 10) || 1;
    const entry = catalogs.find((c) => c.id === id) || catalogs[0];
    if (!entry) return;
    if (entry !== current) openCatalog(entry, page);
    else if (doc && pageText) go(spreadOfPage(Math.min(doc.numPages, Math.max(1, page))));
  }
  function selectTab(entry) {
    if (entry === current) return;
    history.replaceState(null, "", "#" + encodeURIComponent(entry.id));
    openCatalog(entry);
  }
  tabsEl.addEventListener("keydown", (event) => {
    const tabs = [...tabsEl.querySelectorAll("[role=tab]")];
    const at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) {
      if (isSuperAdmin) moveCatalog(tabs[at].dataset.id, at + move);
      return;
    }
    const next = tabs[(at + move + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
  window.addEventListener("hashchange", selectFromHash);

  async function init() {
    showState("loading", "กำลังโหลดรายการแคตตาล็อก…");
    try {
      const response = await fetch("/api/catalogs", { cache: "no-store" });
      if (!response.ok) throw Object.assign(new Error("HTTP " + response.status), { status: response.status });
      catalogs = (await response.json()).catalogs || [];
    } catch (error) {
      titleEl.textContent = "แคตตาล็อกสินค้า";
      showState("error", "โหลดรายการแคตตาล็อกไม่สำเร็จ", errorText(error), init);
      return;
    }
    renderTabs();
    selectFromHash();
  }
  let dragId = null;
  async function moveCatalog(id, to) {
    const from = catalogs.findIndex((c) => c.id === id);
    if (from < 0 || to < 0 || to >= catalogs.length || from === to) return;
    const previous = catalogs.slice();
    const [moved] = catalogs.splice(from, 1);
    catalogs.splice(to, 0, moved);
    renderTabs();
    tabsEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
    try {
      const response = await fetch("/api/catalogs/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
        body: JSON.stringify({ order: catalogs.map((c) => c.id) }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "บันทึกลำดับไม่สำเร็จ");
    } catch (error) {
      catalogs = previous;
      renderTabs();
      alert(error.message || "บันทึกลำดับไม่สำเร็จ");
    }
  }
  function renderTabs() {
    tabsEl.replaceChildren(
      ...catalogs.map((entry) => {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(entry === current));
        tab.tabIndex = entry === current ? 0 : -1;
        tab.setAttribute("aria-controls", "ecat-viewer");
        tab.dataset.id = entry.id;
        tab.textContent = entry.title;
        tab.addEventListener("click", () => selectTab(entry));
        // Super Admin: drag a tab onto another to reorder (saved on the server for everyone).
        tab.addEventListener("dragstart", (event) => {
          dragId = entry.id;
          event.dataTransfer.effectAllowed = "move";
          tab.classList.add("is-dragging");
        });
        tab.addEventListener("dragend", () => {
          dragId = null;
          tabsEl.querySelectorAll(".is-dragging, .is-drop").forEach((el) => el.classList.remove("is-dragging", "is-drop"));
        });
        tab.addEventListener("dragover", (event) => {
          if (!dragId || dragId === entry.id) return;
          event.preventDefault();
          tab.classList.add("is-drop");
        });
        tab.addEventListener("dragleave", () => tab.classList.remove("is-drop"));
        tab.addEventListener("drop", (event) => {
          event.preventDefault();
          tab.classList.remove("is-drop");
          moveCatalog(dragId, catalogs.indexOf(entry));
        });
        return tab;
      }),
    );
    if (!catalogs.length) {
      current = null;
      titleEl.textContent = "แคตตาล็อกสินค้า";
      downloadLink.setAttribute("aria-disabled", "true");
      showState("empty", "ยังไม่มีแคตตาล็อก", canManage ? "กด “เพิ่มแคตตาล็อก” เพื่อเพิ่มเล่มจากลิงก์ Google Drive" : "ผู้ดูแลระบบยังไม่ได้เพิ่มเล่มแคตตาล็อก");
    }
    syncManage();
  }

  // ---------- search the PDF text (pdf.js text layer; image-only pages have no text) ----------
  const searchInput = $("ecat-search"),
    searchResults = $("ecat-search-results");
  let textIndex = null; // { token, pages: Promise<string[]> }
  // "X-18" / "x18" / "x 18" all match "X-18", but never inside another word or model:
  // separators are optional only between the typed characters, and an English letter/digit edge
  // must not start inside another word ("BOX 18" is not "X-18"). A typed prefix still works ("PD-48" finds PD-4800);
  // pages where the match also ends at a word edge (exactly "X-18", not "X-180") are listed first.
  function searchPattern(query) {
    const chars = [...query.toLowerCase().replace(/[\s\-_./]+/g, "")];
    if (chars.length < 2) return null;
    const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = chars.map(esc).join("[\\s\\-_./]*");
    const alnum = /[a-z0-9]/;
    const head = alnum.test(chars[0]) ? "(?<![a-z0-9])" : "";
    const tail = alnum.test(chars[chars.length - 1]) ? "(?![a-z0-9])" : "";
    return { any: new RegExp(head + body, "i"), exact: new RegExp(head + body + tail, "i") };
  }
  function pageTexts() {
    if (textIndex?.token === loadToken) return textIndex.pages;
    const token = loadToken,
      pdf = doc;
    const pages = (async () => {
      const texts = [],
        labels = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (token !== loadToken) throw new Error("stale");
        const page = await pdf.getPage(p);
        const height = page.getViewport({ scale: 1 }).height;
        const content = await page.getTextContent();
        texts.push(content.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
        // Category label printed at the bottom of the page, e.g. "AUDIO MIXER" (all-caps words, no digits = not a model).
        // Pages with only a Thai footer (e.g. "หางปลา") fall back to the Thai text.
        const footer = content.items.filter((i) => i.transform[5] < height * 0.08).map((i) => i.str.trim());
        const label =
          footer.find((t) => /^[A-Z][A-Z &/-]{2,}$/.test(t)) ||
          footer.find((t) => /^[฀-๿][฀-๿ &/()-]{1,}$/.test(t));
        labels.push(label || "");
        if (p % 10 === 0) renderSearchStatus(`กำลังเตรียมค้นหา… ${p}/${pdf.numPages} หน้า`);
      }
      return { texts, labels };
    })();
    textIndex = { token, pages };
    pages.catch(() => (textIndex = null));
    return pages;
  }
  function renderSearchStatus(text) {
    if (searchInput.value.trim().length < 2) return;
    const p = document.createElement("p");
    p.className = "ecat-search-status";
    p.textContent = text;
    searchResults.replaceChildren(p);
    openResults(true);
  }
  function openResults(open) {
    searchResults.hidden = !open;
    searchInput.setAttribute("aria-expanded", String(open));
  }
  let searchTimer,
    searchSeq = 0;
  async function runSearch() {
    const query = searchInput.value.trim();
    const seq = ++searchSeq;
    if (query.length < 2 || !doc) return openResults(false);
    renderSearchStatus("กำลังค้นหา…");
    let texts;
    try {
      texts = (await pageTexts()).texts;
    } catch {
      if (seq === searchSeq) renderSearchStatus("ค้นหาไม่สำเร็จ กรุณาลองใหม่");
      return;
    }
    if (seq !== searchSeq) return;
    const pattern = searchPattern(query);
    const hits = [];
    if (pattern)
      texts.forEach((text, i) => {
        const m = pattern.exact.exec(text) || pattern.any.exec(text);
        if (m) hits.push({ page: i + 1, text, at: m.index, len: m[0].length, exact: pattern.exact.test(text) });
      });
    hits.sort((a, b) => b.exact - a.exact || a.page - b.page);
    if (!hits.length) {
      const noText = texts.every((t) => !t);
      renderSearchStatus(noText ? "ไฟล์นี้เป็นรูปภาพล้วน ไม่มีข้อความให้ค้นหา" : `ไม่พบ “${query}”`);
      return;
    }
    const head = document.createElement("p");
    head.className = "ecat-search-status";
    head.textContent = `พบ ${hits.length} หน้า`;
    const items = hits.slice(0, 60).map(({ page, text, at, len }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ecat-search-hit";
      const label = document.createElement("strong");
      label.textContent = `หน้า ${page}`;
      const snippet = document.createElement("span");
      if (at >= 0) {
        const start = Math.max(0, at - 40);
        snippet.append(
          (start ? "…" : "") + text.slice(start, at),
          Object.assign(document.createElement("mark"), { textContent: text.slice(at, at + len) }),
          text.slice(at + len, at + len + 60) + "…",
        );
      } else snippet.textContent = text.slice(0, 100) + "…";
      button.append(label, snippet);
      button.addEventListener("click", () => {
        openResults(false);
        go(spreadOfPage(page));
      });
      return button;
    });
    searchResults.replaceChildren(head, ...items);
    openResults(true);
  }
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  searchInput.addEventListener("focus", () => {
    if (searchResults.childElementCount && searchInput.value.trim().length >= 2) openResults(true);
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") openResults(false);
    if (event.key === "Enter") searchResults.querySelector(".ecat-search-hit")?.click();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".ecat-search")) openResults(false);
  });

  // ---------- category drop-down (from the footer labels, or set by hand by Super Admin) ----------
  const ACRONYMS = new Set(["ABS", "PA", "LED", "DJ", "DSP", "USB", "UHF", "VHF", "PAR"]);
  const titleCase = (s) =>
    s
      .toLowerCase()
      .replace(/(^|[\s/-])([a-z]+)/g, (m, sep, word) => sep + (ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)));
  // Thai names for the footer labels used in the catalogue (unknown labels keep the English name only).
  const THAI = {
    "AUDIO MIXER": "มิกเซอร์",
    "POWER AMPLIFIER": "เพาเวอร์แอมป์",
    CROSSOVER: "ครอสโอเวอร์",
    EQUALIZER: "อีควอไลเซอร์",
    "STEREO AMPLIFIER": "แอมป์สเตอริโอ",
    "PRE-AMPLIFIER": "ปรีแอมป์",
    "WIRELESS MICROPHONE": "ไมโครโฟนไร้สาย",
    "WIRELESS MICROPHONE ACCESSORIES": "อุปกรณ์เสริมไมโครโฟนไร้สาย",
    "WIRELESS CONFERENCE SYSTEM": "ชุดไมค์ประชุมไร้สาย",
    "WIRED CONFERENCE MICROPHONE": "ไมค์ประชุมแบบมีสาย",
    "WIRED CONFERENCE SYSTEM": "ชุดไมค์ประชุมแบบมีสาย",
    MICROPHONE: "ไมโครโฟน",
    "MICROPHONE CARTRIDGE": "หัวไมโครโฟน",
    "ABS RACK": "แร็ค ABS",
    "PORTABLE ACTIVE SPEAKER BOX": "ลำโพงเคลื่อนที่ (มีแอมป์ในตัว)",
    "ACTIVE SPEAKER BOX": "ตู้ลำโพงมีแอมป์ในตัว",
    "PASSIVE SPEAKER BOX": "ตู้ลำโพงพาสซีฟ",
    "WALL MOUNT SPEAKER BOX": "ลำโพงติดผนัง",
    "CEILING SPEAKER / COLUMN SPEAKER BOX": "ลำโพงเพดาน / ลำโพงคอลัมน์",
    "ACTIVE COLUMN PA SPEAKER BOX": "ลำโพงคอลัมน์ PA มีแอมป์ในตัว",
    "ACTIVE LINE ARRAY PA SPEAKER BOX": "ลำโพงไลน์อาเรย์ PA มีแอมป์ในตัว",
    MEGAPHONE: "โทรโข่ง",
    "HORN SPEAKER": "ลำโพงฮอร์น",
    "DRIVER UNIT": "ไดรเวอร์ยูนิต",
    "TWEETER HORN": "ทวีตเตอร์ฮอร์น",
    SPEAKER: "ดอกลำโพง",
    "PIEZO TWEETER": "ทวีตเตอร์เปียโซ",
    "CAR AUDIO": "เครื่องเสียงรถยนต์",
    "POWER SEQUENCE CONTROLLER": "ตัวควบคุมลำดับการเปิดไฟ",
    "LED PAR LIGHT": "ไฟพาร์ LED",
    BATTERY: "แบตเตอรี่",
    CAPACITOR: "คาปาซิเตอร์",
    "HEAT SHRINKABLE TUBE": "ท่อหด",
  };
  const sectionTitle = (label) =>
    /[฀-๿]/.test(label) ? label : THAI[label] ? `${THAI[label]} · ${titleCase(label)}` : titleCase(label);
  function autoSections(labels) {
    const out = [];
    let prev = "";
    labels.forEach((label, i) => {
      if (label && label !== prev) out.push({ title: sectionTitle(label), page: i + 1 });
      if (label) prev = label;
    });
    return out;
  }
  async function loadSections(entry, token) {
    if (Array.isArray(entry.sections) && entry.sections.length) sections = entry.sections;
    else {
      try {
        sections = autoSections((await pageTexts()).labels);
      } catch {
        sections = [];
      }
    }
    if (token === loadToken) renderSections();
  }
  function renderSections() {
    // Custom list instead of a native <select>: the native popup is as wide as
    // the longest option and overflows narrow screens; this one wraps.
    closeSectionList();
    $("ecat-section-list").replaceChildren(
      ...sections.map((s) => {
        const option = Object.assign(document.createElement("button"), { type: "button", className: "ecat-section-option" });
        option.setAttribute("role", "option");
        option.dataset.page = String(s.page);
        option.append(
          Object.assign(document.createElement("span"), { textContent: s.title }),
          Object.assign(document.createElement("small"), { textContent: `หน้า ${s.page}` }),
        );
        return option;
      }),
    );
    syncManage();
    syncSectionSelect();
  }
  function syncSectionSelect() {
    const label = document.getElementById("ecat-section-label");
    if (!label) return;
    const page = spreads[index] ? spreads[index].right || spreads[index].left : 0;
    const hit = page ? [...sections].reverse().find((s) => s.page <= page) : null;
    label.textContent = hit ? `${hit.title} · หน้า ${hit.page}` : `หมวดหมู่ (${sections.length})`;
    for (const option of $("ecat-section-list").children)
      option.setAttribute("aria-selected", String(Boolean(hit) && option.dataset.page === String(hit.page)));
  }
  function closeSectionList() {
    $("ecat-section-list").hidden = true;
    $("ecat-section").setAttribute("aria-expanded", "false");
  }
  function openSectionList() {
    const list = $("ecat-section-list");
    if (!list.children.length) return;
    list.hidden = false;
    $("ecat-section").setAttribute("aria-expanded", "true");
    const selected = list.querySelector('[aria-selected="true"]') || list.firstElementChild;
    selected.focus();
    selected.scrollIntoView({ block: "nearest" });
  }
  $("ecat-section").addEventListener("click", () => ($("ecat-section-list").hidden ? openSectionList() : closeSectionList()));
  $("ecat-section").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openSectionList();
  });
  $("ecat-section-list").addEventListener("click", (event) => {
    const option = event.target.closest(".ecat-section-option");
    if (!option) return;
    const page = Number(option.dataset.page);
    closeSectionList();
    $("ecat-section").focus();
    if (page && doc) go(spreadOfPage(Math.min(doc.numPages, page)));
  });
  $("ecat-section-list").addEventListener("keydown", (event) => {
    const list = event.currentTarget,
      active = document.activeElement;
    let next = null;
    if (event.key === "ArrowDown") next = active.nextElementSibling || list.firstElementChild;
    else if (event.key === "ArrowUp") next = active.previousElementSibling || list.lastElementChild;
    else if (event.key === "Home") next = list.firstElementChild;
    else if (event.key === "End") next = list.lastElementChild;
    else if (event.key === "Escape" || event.key === "Tab") {
      closeSectionList();
      if (event.key === "Escape") $("ecat-section").focus();
      return;
    } else return;
    event.preventDefault();
    next?.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!$("ecat-section-list").hidden && !event.target.closest(".ecat-section-picker")) closeSectionList();
  });
  // Super Admin: edit / rename the categories ("<page> <title>" per line).
  const sectionsDialog = $("ecat-sections-dialog"),
    sectionsForm = $("ecat-sections-form"),
    sectionsError = $("ecat-sections-error");
  $("ecat-sections-edit").addEventListener("click", () => {
    sectionsForm.elements.lines.value = sections.map((s) => `${s.page} ${s.title}`).join("\n");
    sectionsError.textContent = "";
    sectionsDialog.showModal();
  });
  $("ecat-sections-cancel").addEventListener("click", () => sectionsDialog.close());
  async function saveSections(list) {
    const entry = current;
    const response = await fetch(`/api/catalogs/${encodeURIComponent(entry.id)}/sections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
      body: JSON.stringify({ sections: list }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
    if (data.sections.length) entry.sections = data.sections;
    else delete entry.sections;
    await loadSections(entry, loadToken);
  }
  sectionsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const list = [];
    for (const [n, line] of sectionsForm.elements.lines.value.split("\n").entries()) {
      if (!line.trim()) continue;
      const m = /^\s*(\d{1,4})\s+(.+?)\s*$/.exec(line);
      if (!m) {
        sectionsError.textContent = `บรรทัด ${n + 1}: ต้องขึ้นต้นด้วยเลขหน้า แล้วเว้นวรรคตามด้วยชื่อหมวด`;
        return;
      }
      list.push({ page: Number(m[1]), title: m[2] });
    }
    try {
      await saveSections(list);
      sectionsDialog.close();
      showToast(list.length ? "บันทึกหมวดหมู่แล้ว" : "ใช้หมวดแบบอัตโนมัติแล้ว");
    } catch (error) {
      sectionsError.textContent = error.message;
    }
  });
  $("ecat-sections-auto").addEventListener("click", async () => {
    try {
      await saveSections([]);
      sectionsDialog.close();
      showToast("ใช้หมวดแบบอัตโนมัติแล้ว");
    } catch (error) {
      sectionsError.textContent = error.message;
    }
  });

  // ---------- thumbnail strip: a drop-down, closed by default so the pages get the room ----------
  const thumbsToggle = $("ecat-thumbs-toggle"),
    thumbsWrap = $("ecat-thumbs-wrap"),
    thumbScrollBtns = thumbsWrap.querySelectorAll(".ecat-thumbs-scroll");
  // Arrows show only when there is more to scroll that way.
  function syncThumbArrows() {
    const max = thumbsEl.scrollWidth - thumbsEl.clientWidth;
    thumbScrollBtns[0].disabled = thumbsEl.scrollLeft <= 2;
    thumbScrollBtns[1].disabled = thumbsEl.scrollLeft >= max - 2;
  }
  thumbScrollBtns.forEach((button) =>
    button.addEventListener("click", () =>
      thumbsEl.scrollBy({ left: Number(button.dataset.dir) * thumbsEl.clientWidth * 0.8, behavior: "smooth" }),
    ),
  );
  thumbsEl.addEventListener("scroll", syncThumbArrows, { passive: true });
  new ResizeObserver(syncThumbArrows).observe(thumbsEl);
  // Mouse wheel (vertical) scrolls the strip sideways.
  thumbsEl.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || thumbsEl.scrollWidth <= thumbsEl.clientWidth) return;
      event.preventDefault();
      thumbsEl.scrollBy({ left: event.deltaY, behavior: "auto" });
    },
    { passive: false },
  );
  // Drag with the mouse to scroll; a real drag does not count as a click on a thumbnail.
  let drag = null;
  thumbsEl.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { x: event.clientX, left: thumbsEl.scrollLeft, moved: false };
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 5) drag.moved = true;
    if (drag.moved) {
      thumbsEl.style.scrollBehavior = "auto";
      thumbsEl.scrollLeft = drag.left - dx;
      thumbsEl.classList.add("is-dragging");
    }
  });
  window.addEventListener("pointerup", () => {
    if (!drag) return;
    if (drag.moved) thumbsEl.addEventListener("click", (e) => (e.stopPropagation(), e.preventDefault()), { capture: true, once: true });
    drag = null;
    thumbsEl.style.scrollBehavior = "";
    thumbsEl.classList.remove("is-dragging");
  });
  function setThumbsOpen(open) {
    thumbsWrap.hidden = !open;
    thumbsToggle.setAttribute("aria-expanded", String(open));
    viewer.classList.toggle("thumbs-open", open);
    try {
      localStorage.setItem("ecat-thumbs-open", open ? "1" : "0");
    } catch {}
    if (open) {
      updateUi(); // scroll the strip to the current spread
      requestAnimationFrame(syncThumbArrows);
    }
  }
  thumbsToggle.addEventListener("click", () => setThumbsOpen(thumbsWrap.hidden));
  try {
    if (localStorage.getItem("ecat-thumbs-open") === "1") setThumbsOpen(true);
  } catch {}

  // ---------- add / remove books (catalog_manage; the server checks again) ----------
  const addBtn = $("ecat-add"),
    addDialog = $("ecat-add-dialog"),
    addForm = $("ecat-add-form"),
    addError = $("ecat-add-error"),
    addSubmit = $("ecat-add-submit"),
    removeBtn = $("ecat-remove");
  let canManage = false,
    isSuperAdmin = false;
  // Download PDF + remove book: Super Admin only (the server enforces both too).
  function syncManage() {
    addBtn.hidden = !canManage;
    removeBtn.hidden = !(isSuperAdmin && current?.custom);
    $("ecat-edit-link").hidden = removeBtn.hidden;
    downloadLink.hidden = !isSuperAdmin;
    tabsEl.querySelectorAll("[role=tab]").forEach((tab) => {
      tab.draggable = isSuperAdmin;
      tab.title = isSuperAdmin ? "ลากเพื่อจัดลำดับ (หรือ Alt + ← / →)" : "";
    });
    $("ecat-sections-edit").hidden = !(isSuperAdmin && current?.custom && doc);
    $("ecat-sections").hidden = !sections.length && $("ecat-sections-edit").hidden;
  }
  (window.prplusUser || Promise.resolve(null))
    .then((user) => {
      isSuperAdmin = user?.role === "super_admin";
      canManage = isSuperAdmin || Boolean(user?.permissions?.includes("catalog_manage"));
      syncManage();
    })
    .catch(() => {});
  const send = async (method, url, body) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
      body: body && JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    return data;
  };
  const syncSource = () => {
    const mode = addForm.elements.source.value;
    addForm.querySelectorAll("[data-source]").forEach((el) => (el.hidden = el.dataset.source !== mode));
    addForm.elements.drive.required = mode === "drive";
    addForm.elements.file.required = mode === "file";
  };
  addForm.querySelectorAll("input[name=source]").forEach((r) => r.addEventListener("change", syncSource));
  addBtn.addEventListener("click", () => {
    addForm.reset();
    syncSource();
    addError.textContent = "";
    addDialog.showModal();
  });
  async function uploadPdf(title, file) {
    if (file.size > 400 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 400 MB");
    const response = await fetch("/api/catalogs/upload", {
      method: "POST",
      headers: { "Content-Type": "application/pdf", "X-PRPlus-Request": "1", "X-Catalog-Title": encodeURIComponent(title) },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || (response.status === 413 ? "ไฟล์ใหญ่เกินที่เซิร์ฟเวอร์รับได้" : "อัปโหลดไม่สำเร็จ กรุณาลองใหม่"));
    return data;
  }
  $("ecat-add-cancel").addEventListener("click", () => addDialog.close());
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    addError.textContent = "";
    addSubmit.disabled = true;
    try {
      const title = addForm.elements.title.value;
      const isFile = addForm.elements.source.value === "file";
      if (isFile) addSubmit.textContent = "กำลังอัปโหลด…";
      const { catalog } = isFile
        ? await uploadPdf(title, addForm.elements.file.files[0])
        : await send("POST", "/api/catalogs", { title, drive: addForm.elements.drive.value });
      catalogs.push(catalog);
      addDialog.close();
      renderTabs();
      selectTab(catalog);
      showToast("เพิ่ม “" + catalog.title + "” แล้ว");
    } catch (error) {
      addError.textContent = error.message;
    } finally {
      addSubmit.textContent = "บันทึก";
      addSubmit.disabled = false;
    }
  });
  removeBtn.addEventListener("click", async () => {
    const entry = current;
    if (!entry?.custom || !confirm(`ลบ “${entry.title}” ออกจากแคตตาล็อก? (ไฟล์ใน Google Drive ไม่ถูกลบ)`)) return;
    removeBtn.disabled = true;
    try {
      await send("DELETE", "/api/catalogs/" + encodeURIComponent(entry.id));
      catalogs = catalogs.filter((c) => c !== entry);
      current = null;
      history.replaceState(null, "", location.pathname);
      renderTabs();
      if (catalogs.length) openCatalog(catalogs[0]);
      showToast("ลบ “" + entry.title + "” แล้ว");
    } catch (error) {
      showToast(error.message);
    } finally {
      removeBtn.disabled = false;
    }
  });
  const linkBtn = $("ecat-edit-link");
  linkBtn.addEventListener("click", async () => {
    const entry = current;
    if (!entry?.custom) return;
    const drive = prompt(`ลิงก์ Google Drive ใหม่ของ “${entry.title}”\n(เช่น https://drive.google.com/file/d/…/view — ไฟล์ต้องแชร์แบบทุกคนที่มีลิงก์)`);
    if (!drive?.trim()) return;
    linkBtn.disabled = true;
    try {
      await send("PUT", "/api/catalogs/" + encodeURIComponent(entry.id) + "/link", { drive: drive.trim() });
      // Same file name on the server; bust the browser cache so the new PDF loads.
      entry.pdf = entry.pdf.split("?")[0] + "?v=" + Date.now();
      current = null;
      openCatalog(entry);
      showToast("เปลี่ยนลิงก์ “" + entry.title + "” แล้ว กำลังโหลดไฟล์ใหม่…");
    } catch (error) {
      showToast(error.message);
    } finally {
      linkBtn.disabled = false;
    }
  });
  init();
})();
