// Product photos on the consignment page: table thumbnails with a hover preview, the gallery in the
// movement-history dialog, a full-screen view and the photo editor. Photos are optional extras: any
// failure falls back to an icon and never touches the stock numbers. Names go in as text, never HTML.
// Photos are the same per-code list as products.html (/api/products/images, app database, not SML).
const links = window.ProductImageLinks;
const $ = (id) => document.getElementById(id);
export const MAX_SHOWN = 5;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const FULL_SIZE = 1200;

const cache = new Map(); // product code -> its own saved links (first = main photo)
const borrowed = new Map(); // consignment code -> { from, links } of the matching regular product
// Shown photos: the product's own, else the regular product's with the same model (server-matched).
const shown = (code) => (cache.get(code)?.length ? cache.get(code) : borrowed.get(code)?.links || []);
const inflight = new Map(); // product code -> pending request
let canEdit = false,
  toast = () => {};

// ---------- server ----------
async function request(codes) {
  const params = new URLSearchParams();
  for (const code of codes) params.append("code", code);
  const response = await fetch("/api/products/images?" + params, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "โหลดรูปสินค้าไม่สำเร็จ");
  canEdit = !!data.canEdit;
  for (const code of codes) {
    cache.set(code, data.images?.[code] || []);
    if (data.borrowed?.[code]) borrowed.set(code, data.borrowed[code]);
    else borrowed.delete(code);
  }
}
// Fetches codes not cached yet (at most 100 per request), sharing requests already in flight.
function fetchImages(codes) {
  const wanted = [...new Set(codes)],
    need = wanted.filter((code) => !cache.has(code) && !inflight.has(code));
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100),
      job = request(chunk).finally(() => chunk.forEach((code) => inflight.delete(code)));
    for (const code of chunk) inflight.set(code, job);
  }
  return Promise.all(wanted.map((code) => inflight.get(code)).filter(Boolean));
}

// ---------- fallback icons by product type ----------
const ICONS = {
  speaker:
    '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><circle cx="12" cy="14.5" r="4"/><circle cx="12" cy="14.5" r="1"/><circle cx="12" cy="6.5" r="1.4"/>',
  stand:
    '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M12 6.5v8M12 14.5l-6.5 7M12 14.5l6.5 7M12 14.5v7"/>',
  battery:
    '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3M7 12h5M9.5 9.5v5"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7"/>',
  other:
    '<path d="M3.5 7.5 12 3l8.5 4.5L12 12z"/><path d="M3.5 7.5v9L12 21l8.5-4.5v-9M12 12v9"/>',
};
// Order matters: "ขาไมค์" is a stand and "ตู้ลำโพง…มีไมค์" is a speaker.
export function kindOf(name) {
  const text = String(name || "");
  if (/แบต|battery/i.test(text)) return "battery";
  if (/^ขา|ขาตั้ง|ขาแขวน|stand|bracket/i.test(text)) return "stand";
  if (/ลำโพง|ตู้|ทวิตเตอร์|ฮอร์น|speaker|tweeter|horn/i.test(text)) return "speaker";
  if (/ไมค์|ไมโครโฟน|mic/i.test(text)) return "mic";
  return "other";
}
function iconFor(name) {
  const span = document.createElement("span");
  span.className = "cs-img-icon";
  // Constant markup from ICONS only; the product name is never part of it.
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[kindOf(name)]}</svg>`;
  return span;
}

// Puts one photo (or the fallback icon) into box. `labelled` boxes (not buttons) carry role="img"
// with the name while showing the icon, so the alt text is never lost.
function fill(box, link, name, width, { lazy = false, labelled = true, onChange } = {}) {
  const src = link ? links.imageSource(link, width) : "";
  box.dataset.link = link || "";
  box.classList.remove("has-image", "is-icon");
  box.removeAttribute("role");
  box.removeAttribute("aria-label");
  const showIcon = () => {
    box.classList.remove("has-image");
    box.classList.add("is-icon");
    if (labelled) {
      box.setAttribute("role", "img");
      box.setAttribute("aria-label", name);
    }
    box.replaceChildren(iconFor(name));
    onChange?.(false);
  };
  if (!src) return showIcon();
  const img = document.createElement("img");
  img.alt = name;
  img.decoding = "async";
  if (lazy) img.loading = "lazy";
  img.onload = () => {
    if (!img.isConnected) return;
    box.classList.add("has-image");
    onChange?.(true);
  };
  img.onerror = () => img.isConnected && showIcon();
  img.src = src;
  box.replaceChildren(img);
}

// ---------- table ----------
export function tableThumb(p) {
  const box = document.createElement("span");
  box.className = "cs-thumb";
  box.dataset.code = p.code;
  box.dataset.name = p.product;
  fill(box, shown(p.code)[0], p.product, 160, { lazy: true });
  return box;
}
function refreshThumbs() {
  for (const box of document.querySelectorAll("#summary .cs-thumb")) {
    const first = shown(box.dataset.code)[0] || "";
    if (box.dataset.link !== first) fill(box, first, box.dataset.name, 160, { lazy: true });
  }
}
// Only the codes on the current page are requested, so thousands of products cost nothing extra.
export function loadTableImages(list) {
  fetchImages(list.map((p) => p.code))
    .catch(() => {}) // Thumbnails are optional; the icons stay.
    .finally(refreshThumbs);
}

// Floating preview that follows the pointer, placed above (or below) the row so the row stays readable.
const preview = document.createElement("div"),
  previewImg = document.createElement("img"),
  canHover = window.matchMedia?.("(hover: hover) and (pointer: fine)");
preview.className = "cs-img-preview";
preview.hidden = true;
previewImg.alt = "";
preview.append(previewImg);
let previewBox = null;
export function hidePreview() {
  previewBox = null;
  preview.hidden = true;
}
function placePreview(event) {
  const size = preview.offsetWidth || 236,
    gap = 12,
    margin = 8,
    row = previewBox.closest("tr").getBoundingClientRect();
  let x = event.clientX + 18;
  if (x + size > innerWidth - margin) x = event.clientX - 18 - size;
  let y = row.top - gap - size;
  if (y < margin) y = row.bottom + gap;
  if (y + size > innerHeight - margin) y = innerHeight - margin - size;
  preview.style.transform = `translate3d(${Math.max(margin, x)}px, ${Math.max(margin, y)}px, 0)`;
}
function installPreview(tbody) {
  document.body.append(preview);
  // pointermove also shows it, so it comes back after a scroll hid it while the pointer stayed put.
  const track = (event) => {
    const box = event.target.closest?.(".cs-thumb.has-image");
    if (!box || !canHover?.matches) return;
    if (box !== previewBox) {
      previewBox = box;
      previewImg.src = links.imageSource(box.dataset.link, 480);
      preview.hidden = false;
    }
    placePreview(event);
  };
  tbody.addEventListener("pointerover", track);
  tbody.addEventListener("pointermove", track);
  tbody.addEventListener("pointerout", (event) => {
    if (previewBox && !previewBox.contains(event.relatedTarget)) hidePreview();
  });
  window.addEventListener("scroll", hidePreview, { passive: true });
}

// ---------- history dialog gallery ----------
let gallery = { product: null, list: [], index: 0 };
export function showProductImages(p) {
  hidePreview();
  gallery = { product: p, list: shown(p.code).slice(0, MAX_SHOWN), index: 0 };
  renderGallery();
  if (cache.has(p.code)) return;
  fetchImages([p.code])
    .catch(() => {})
    .finally(() => {
      if (gallery.product !== p || !cache.has(p.code)) return;
      gallery.list = shown(p.code).slice(0, MAX_SHOWN);
      renderGallery();
    });
}
function renderGallery() {
  const { product: p, list, index } = gallery,
    main = $("history-main-image"),
    strip = $("history-strip");
  main.disabled = true;
  main.setAttribute("aria-label", list.length ? `ดูรูป ${p.product} เต็มจอ` : `ยังไม่มีรูป ${p.product}`);
  fill(main, list[index], p.product, 800, {
    labelled: false,
    onChange: (ok) => (main.disabled = !ok),
  });
  strip.hidden = list.length < 2;
  strip.replaceChildren(
    ...list.map((link, i) => {
      const button = document.createElement("button"),
        box = document.createElement("span");
      button.type = "button";
      button.className = "cs-strip-thumb";
      button.setAttribute("aria-pressed", String(i === index));
      button.setAttribute("aria-label", `รูปที่ ${i + 1} จาก ${list.length}`);
      box.className = "cs-strip-media";
      fill(box, link, p.product, 160, { labelled: false });
      button.append(box);
      button.onclick = () => {
        gallery.index = i;
        renderGallery();
        strip.children[i]?.focus({ preventScroll: true });
      };
      return button;
    }),
  );
  const from = borrowedFrom(p.code),
    source = $("history-image-source");
  source.hidden = !from;
  source.textContent = from ? `รูปจากสินค้า ${from}` : "";
  $("history-edit-images").hidden = !canEdit;
}
const borrowedFrom = (code) => (!cache.get(code)?.length && borrowed.get(code)?.from) || "";
function showLightbox() {
  const { product: p, list, index } = gallery;
  if (!list[index]) return;
  const img = $("lightbox-image");
  img.alt = p.product;
  img.src = links.imageSource(list[index], 2000);
  $("history-lightbox").showModal();
}
function stepLightbox(delta) {
  const { list } = gallery;
  if (list.length < 2) return;
  gallery.index = (gallery.index + delta + list.length) % list.length;
  renderGallery();
  $("lightbox-image").src = links.imageSource(list[gallery.index], 2000);
}

// ---------- editor (product_images permission; the server checks it again) ----------
let editor = null; // { product, items: [{ link } | { uploading, name }], dirty, token }
let dragIndex = -1;
function editorStatus(text, isError = false) {
  const box = $("image-editor-status");
  box.textContent = text;
  box.classList.toggle("is-error", isError);
}
function openEditor() {
  const p = gallery.product;
  if (!p) return;
  editor = {
    product: p,
    items: (cache.get(p.code) || []).map((link) => ({ link })),
    dirty: false,
    token: Symbol(),
  };
  $("image-editor-code").textContent = `${p.code} · ${p.product}`;
  $("image-editor-link").value = "";
  const from = borrowedFrom(p.code);
  editorStatus(from ? `ตอนนี้แสดงรูปจากสินค้า ${from} · เพิ่มรูปของรหัสนี้เองเพื่อใช้แทน` : "");
  renderEditor();
  $("image-editor").showModal();
}
function move(from, to) {
  if (from === to || from < 0 || to < 0 || to >= editor.items.length) return;
  const [item] = editor.items.splice(from, 1);
  editor.items.splice(to, 0, item);
  editor.dirty = true;
  renderEditor();
}
function tileButton(text, label, onclick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  if (label) button.setAttribute("aria-label", label);
  button.onclick = onclick;
  return button;
}
function renderEditor() {
  const list = $("image-editor-list"),
    { items, product: p } = editor,
    uploading = items.some((item) => item.uploading);
  list.replaceChildren(
    ...items.map((item, i) => {
      const li = document.createElement("li"),
        media = document.createElement("span");
      li.className = "cs-img-tile" + (item.uploading ? " is-uploading" : "");
      media.className = "cs-img-tile-media";
      li.append(media);
      if (item.uploading) {
        media.textContent = "กำลังอัปโหลด…";
        return li;
      }
      fill(media, item.link, p.product, 320);
      if (i === 0) {
        const badge = document.createElement("span");
        badge.className = "cs-img-tile-badge";
        badge.textContent = "รูปหลัก";
        li.append(badge);
      }
      const actions = document.createElement("div");
      actions.className = "cs-img-tile-actions";
      const left = tileButton("←", `เลื่อนรูปที่ ${i + 1} ไปก่อนหน้า`, () => move(i, i - 1)),
        right = tileButton("→", `เลื่อนรูปที่ ${i + 1} ไปถัดไป`, () => move(i, i + 1));
      left.disabled = i === 0;
      right.disabled = i === items.length - 1;
      actions.append(left, right);
      if (i > 0) actions.append(tileButton("ตั้งรูปหลัก", `ตั้งรูปที่ ${i + 1} เป็นรูปหลัก`, () => move(i, 0)));
      actions.append(
        tileButton("ลบ", `ลบรูปที่ ${i + 1}`, () => {
          editor.items.splice(i, 1);
          editor.dirty = true;
          renderEditor();
        }, "is-danger"),
      );
      li.append(actions);
      li.draggable = true;
      li.ondragstart = (event) => {
        dragIndex = i;
        li.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(i));
      };
      li.ondragend = () => {
        dragIndex = -1;
        li.classList.remove("is-dragging");
      };
      li.ondragover = (event) => {
        if (dragIndex < 0) return;
        event.preventDefault();
        li.classList.add("is-drop");
      };
      li.ondragleave = () => li.classList.remove("is-drop");
      li.ondrop = (event) => {
        if (dragIndex < 0) return;
        event.preventDefault();
        move(dragIndex, i);
      };
      return li;
    }),
  );
  $("image-editor-add").hidden = items.length >= MAX_SHOWN;
  $("image-editor-link-form").hidden = items.length >= MAX_SHOWN;
  $("image-editor-save").disabled = uploading || !editor.dirty;
  $("image-editor-title").textContent = `รูปสินค้า (${items.length}/${MAX_SHOWN})`;
}
// Browser-side resize: longest side at most `max` px on white, WebP where supported, else JPEG.
async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, done: () => bitmap.close() };
    } catch {}
  }
  const url = URL.createObjectURL(file),
    img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: img, done: () => URL.revokeObjectURL(url) };
}
const toBlob = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
async function encode(source, max) {
  const scale = Math.min(1, max / Math.max(source.width, source.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const webp = await toBlob(canvas, "image/webp");
  return webp?.type === "image/webp" ? webp : toBlob(canvas, "image/jpeg");
}
async function upload(code, file) {
  const { source, done } = await decode(file);
  let main, thumb;
  try {
    main = await encode(source, FULL_SIZE);
    thumb = await encode(source, links.THUMB_WIDTH);
  } finally {
    done();
  }
  if (!main || !thumb) throw new Error("ย่อรูปไม่สำเร็จ");
  if (main.size > MAX_UPLOAD_BYTES) throw new Error("รูปยังใหญ่เกิน 2MB หลังย่อ");
  const response = await fetch("/api/products/images/files?code=" + encodeURIComponent(code), {
    method: "POST",
    headers: { "Content-Type": main.type, "X-Thumb-Bytes": String(thumb.size), "X-PRPlus-Request": "1" },
    body: new Blob([thumb, main]),
    signal: AbortSignal.timeout(30000),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok)
    throw new Error(response.status === 403 ? "บัญชีนี้ไม่มีสิทธิ์แก้ไขรูปสินค้า" : data.error || "อัปโหลดไม่สำเร็จ");
  return data.link;
}
function addFiles(files) {
  const session = editor,
    problems = [];
  let room = MAX_SHOWN - session.items.length;
  for (const file of files) {
    if (!UPLOAD_TYPES.includes(file.type)) problems.push(`${file.name}: รองรับเฉพาะ JPG, PNG, WebP`);
    else if (file.size > MAX_UPLOAD_BYTES) problems.push(`${file.name}: ใหญ่เกิน 2MB`);
    else if (room <= 0) problems.push(`${file.name}: ใส่ได้ไม่เกิน ${MAX_SHOWN} รูป`);
    else {
      room--;
      const item = { uploading: true, name: file.name };
      session.items.push(item);
      upload(session.product.code, file)
        .then((link) => {
          delete item.uploading;
          item.link = link;
          session.dirty = true;
        })
        .catch((error) => {
          session.items.splice(session.items.indexOf(item), 1);
          if (editor === session) editorStatus(`${file.name}: ${error.message}`, true);
        })
        .finally(() => editor === session && renderEditor());
    }
  }
  editorStatus(problems.join(" · "), problems.length > 0);
  renderEditor();
}
// Links go through the same rules as products.html and the server (Drive links are normalized).
function addLinks(text) {
  const problems = [];
  let added = 0;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const result = links.normalizeImageLink(raw);
    if (!result.ok)
      problems.push(result.reason === "folder" ? "ลิงก์โฟลเดอร์ใช้ไม่ได้ ต้องเป็นลิงก์ไฟล์รูป" : `ลิงก์ไม่ถูกต้อง: ${raw.slice(0, 60)}`);
    else if (editor.items.some((item) => item.link === result.value)) problems.push("มีลิงก์นี้อยู่แล้ว");
    else if (editor.items.length >= MAX_SHOWN) problems.push(`ใส่ได้ไม่เกิน ${MAX_SHOWN} รูป`);
    else {
      editor.items.push({ link: result.value });
      editor.dirty = true;
      added++;
    }
  }
  const done = added ? `เพิ่ม ${added} ลิงก์แล้ว · กดบันทึกรูปเพื่อใช้งาน` : "";
  editorStatus([done, ...new Set(problems)].filter(Boolean).join(" · "), problems.length > 0);
  renderEditor();
  return problems.length === 0;
}
async function saveEditor() {
  const session = editor,
    code = session.product.code;
  $("image-editor-save").disabled = true;
  editorStatus("กำลังบันทึก…");
  try {
    const response = await fetch("/api/products/images", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
      body: JSON.stringify({ code, links: session.items.map((item) => item.link) }),
      signal: AbortSignal.timeout(20000),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {}
    if (!response.ok)
      throw new Error(response.status === 403 ? "บัญชีนี้ไม่มีสิทธิ์แก้ไขรูปสินค้า" : data.error || "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    cache.set(code, data.links);
    session.dirty = false;
    closeEditor(true);
    refreshThumbs();
    if (gallery.product?.code === code) showProductImages(gallery.product);
    toast("บันทึกรูปสินค้าแล้ว");
  } catch (error) {
    if (editor !== session) return;
    editorStatus(error.message, true);
    renderEditor();
  }
}
function closeEditor(force = false) {
  if (!editor) return;
  if (!force && editor.dirty && !window.confirm("ยังไม่ได้บันทึกการเปลี่ยนรูป ต้องการปิดหรือไม่?")) return;
  editor = null;
  $("image-editor-file").value = "";
  $("image-editor").close();
}

// ---------- wiring ----------
export function initProductImages(options = {}) {
  toast = options.toast || toast;
  installPreview($("summary"));
  $("history-main-image").onclick = showLightbox;
  $("history-edit-images").onclick = openEditor;
  const lightbox = $("history-lightbox");
  $("close-lightbox").onclick = () => lightbox.close();
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  lightbox.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") stepLightbox(-1);
    if (event.key === "ArrowRight") stepLightbox(1);
  });
  const dialog = $("image-editor"),
    add = $("image-editor-add");
  $("image-editor-file").addEventListener("change", (event) => {
    if (editor) addFiles([...event.target.files]);
    event.target.value = "";
  });
  add.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    add.classList.add("is-dragover");
  });
  add.addEventListener("dragleave", () => add.classList.remove("is-dragover"));
  add.addEventListener("drop", (event) => {
    add.classList.remove("is-dragover");
    if (!event.dataTransfer?.files.length || !editor) return;
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  });
  $("image-editor-link-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("image-editor-link");
    if (editor && input.value.trim() && addLinks(input.value)) input.value = "";
  });
  $("image-editor-save").onclick = saveEditor;
  $("image-editor-cancel").onclick = () => closeEditor();
  $("close-image-editor").onclick = () => closeEditor();
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault(); // Esc asks first when there are unsaved changes.
    closeEditor();
  });
}
