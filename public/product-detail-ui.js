// Product detail modal for products.html: image gallery from Google Drive links, image-link editor,
// register values and the best-seller panel. products-ui.js opens it via window.ProductDetail.open().
// All text goes in with textContent; nothing from SML or from typed links is inserted as HTML.
(() => {
  const byId = (id) => document.getElementById(id);
  const links = window.ProductImageLinks;
  const dialog = byId("product-detail"),
    lightbox = byId("pd-lightbox"),
    toastBox = byId("pd-toast");
  const el = (tag, className = "", text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const count = (n) => Number(n).toLocaleString("th-TH");
  const blank = (value) => value == null || String(value).trim() === "";
  const stamp = (value) =>
    new Date(value).toLocaleString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

  // ---------- shared state ----------
  const imageCache = new Map(); // product code -> saved links (normalized)
  let canEdit = false,
    canRank = false,
    product = null,
    opener = null,
    images = [],
    index = 0,
    editing = false,
    imageToken = 0,
    detailRequest = 0,
    bestSellerRequest = 0;

  window.addEventListener("prplus-access", (event) => {
    const detail = event.detail || {};
    canRank = detail.role === "super_admin" || !!detail.permissions?.includes("best_sellers");
    canEdit = detail.role === "super_admin" || !!detail.permissions?.includes("product_images");
    if (dialog.open && !editing) renderMedia();
  });

  // ---------- server ----------
  async function fetchImages(codes) {
    const params = new URLSearchParams();
    for (const code of codes) params.append("code", code);
    const response = await fetch("/api/products/images?" + params, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "โหลดลิงก์รูปไม่สำเร็จ");
    canEdit = !!data.canEdit;
    for (const code of codes) imageCache.set(code, data.images?.[code] || []);
    return data.images || {};
  }
  // Saves to the app database for everyone (not localStorage). Returns the normalized links.
  async function saveImages(code, list) {
    const response = await fetch("/api/products/images", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
      body: JSON.stringify({ code, links: list }),
      signal: AbortSignal.timeout(20000),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {}
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? "บัญชีนี้ไม่มีสิทธิ์แก้ไขรูปสินค้า"
          : data.error || "บันทึกไม่สำเร็จ กรุณาลองใหม่",
      );
    imageCache.set(code, data.links);
    return data.links;
  }
  window.saveImages = saveImages;

  // ---------- table thumbnails ----------
  function fillThumbs() {
    document.querySelectorAll("#product-table .thumb-cell").forEach((cell) => {
      const first = imageCache.get(cell.dataset.code)?.[0];
      const src = first ? links.imageSource(first, 160) : "";
      const img = cell.querySelector("img");
      if (!src) return img?.remove();
      if (img?.dataset.src === src) return;
      const thumb = el("img");
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.dataset.src = src;
      thumb.onerror = () => (thumb.hidden = true); // unreachable image: hide instead of a broken icon
      thumb.src = src;
      img ? img.replaceWith(thumb) : cell.append(thumb);
    });
  }
  async function loadPageImages(rows) {
    const codes = [...new Set(rows.map((row) => row.code).filter(Boolean))].slice(0, 100);
    if (!codes.length) return;
    try {
      await fetchImages(codes);
      fillThumbs();
    } catch {
      // Thumbnails are optional; the table stays usable without them.
    }
  }
  window.addEventListener("products-rendered", (event) => loadPageImages(event.detail.rows));
  if (window.productPage) loadPageImages(window.productPage.rows);

  // ---------- toast + clipboard ----------
  let toastTimer;
  function toast(text) {
    toastBox.textContent = text;
    try {
      toastBox.hidePopover?.();
      toastBox.showPopover?.();
    } catch {}
    toastBox.classList.remove("is-shown");
    void toastBox.offsetWidth;
    toastBox.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastBox.classList.remove("is-shown");
      try {
        toastBox.hidePopover?.();
      } catch {}
    }, 1900);
  }
  async function copyText(text, done) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Fallback for non-secure origins (e.g. http://<server-ip>:3000). The textarea must sit inside
      // the open modal, because everything outside a modal dialog is inert.
      const area = el("textarea", "pd-copy-buffer");
      area.value = text;
      area.setAttribute("readonly", "");
      (dialog.open ? dialog : document.body).append(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {}
      area.remove();
    }
    toast(ok ? done : "คัดลอกไม่สำเร็จ กรุณาคัดลอกเอง");
  }

  // ---------- product mapping ----------
  function mapProduct(row) {
    const page = window.productPage || {};
    const sub = blank(row.group_sub)
      ? ""
      : page.subgroups?.find((g) => g.code === row.group_sub)?.name || row.group_sub;
    return {
      code: row.code,
      name: row.name_1 || row.code,
      group: row.group_main_name || row.group_main || "",
      sub,
      unit: row.unit_standard || "",
      stock: blank(row.balance_qty) ? null : Number(row.balance_qty),
      price: row.catalog_sale_price,
      moving: row.activity_2568_2569 === "มีการเคลื่อนไหว",
      images: imageCache.get(row.code) || [],
      updatedAt: page.updatedAt,
    };
  }

  // ---------- info column ----------
  function priceParts(value) {
    if (blank(value)) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return { whole: String(value).trim(), fraction: "" };
    const [whole, fraction] = number
      .toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .split(".");
    return { whole, fraction: fraction ? "." + fraction : "" };
  }
  function renderInfo() {
    byId("detail-title").textContent = product.name;
    const tags = byId("pd-tags");
    tags.replaceChildren();
    const codeTag = el("button", "pd-tag is-code");
    codeTag.type = "button";
    codeTag.title = "คลิกเพื่อคัดลอกรหัส";
    codeTag.setAttribute("aria-label", `คัดลอกรหัส ${product.code}`);
    codeTag.append(el("code", "", product.code));
    codeTag.onclick = () => copyText(product.code, `คัดลอกรหัส ${product.code} แล้ว`);
    tags.append(codeTag);
    for (const value of [product.group, product.sub, product.unit ? `หน่วย: ${product.unit}` : ""])
      if (!blank(value)) tags.append(el("span", "pd-tag", value));
    const price = byId("pd-price"),
      parts = priceParts(product.price);
    price.replaceChildren();
    if (!parts) price.textContent = "—";
    else price.append(document.createTextNode((Number.isFinite(Number(product.price)) ? "฿" : "") + parts.whole), el("small", "", parts.fraction));
    const summary = byId("detail-summary");
    summary.replaceChildren();
    const stockValue = el("strong");
    if (product.stock === null) stockValue.textContent = "—";
    else
      stockValue.append(
        document.createTextNode(product.stock.toLocaleString("th-TH", { maximumFractionDigits: 2 })),
        el("small", "", product.unit ? " " + product.unit : ""),
      );
    // NULL stock means "no data", never "out of stock".
    const stockState =
      product.stock === null
        ? ["is-muted", "ไม่มีข้อมูล"]
        : product.stock > 0
          ? ["is-good", "มีสินค้า"]
          : ["is-bad", "ไม่มีสินค้า"];
    const moving = product.moving ? ["is-info", "มีการเคลื่อนไหว"] : ["is-muted", "ไม่เคลื่อนไหว"];
    const metric = (label, value) => {
      const card = el("article", "pd-metric");
      card.append(el("span", "", label), value);
      return card;
    };
    const dot = ([tone, text]) => {
      const value = el("strong", `pd-dot ${tone}`);
      value.append(el("i"), document.createTextNode(text));
      return value;
    };
    summary.append(
      metric("คงเหลือในทะเบียน", stockValue),
      metric("สถานะคงเหลือ", dot(stockState)),
      metric("การเคลื่อนไหว", dot(moving)),
    );
    byId("detail-subtitle").textContent = product.updatedAt
      ? `ดึงข้อมูล ${stamp(product.updatedAt)}`
      : "";
  }

  // ---------- gallery ----------
  const current = () => images[index];
  const viewLink = (link) => links.normalizeImageLink(link).value || link;
  function showImage() {
    const token = ++imageToken,
      img = byId("pd-image"),
      link = current();
    byId("pd-error").hidden = true;
    if (!link) return;
    byId("pd-spinner").hidden = false;
    img.hidden = true;
    img.onload = () => {
      if (token !== imageToken) return;
      byId("pd-spinner").hidden = true;
      img.hidden = false;
    };
    img.onerror = () => {
      if (token !== imageToken) return;
      byId("pd-spinner").hidden = true;
      byId("pd-error").hidden = false;
    };
    img.alt = `${product.name} รูปที่ ${index + 1}`;
    img.src = links.imageSource(link, 1200);
  }
  function renderMedia() {
    const has = images.length > 0,
      many = images.length > 1;
    index = Math.min(index, Math.max(0, images.length - 1));
    byId("pd-empty").hidden = has;
    byId("pd-empty-add").hidden = !canEdit;
    byId("pd-frame").hidden = !has;
    byId("pd-prev").hidden = byId("pd-next").hidden = !many;
    byId("pd-counter").hidden = !many;
    byId("pd-counter").textContent = many ? `${index + 1} / ${images.length}` : "";
    const edit = byId("pd-edit");
    edit.hidden = !canEdit;
    byId("pd-edit-label").textContent = has ? "แก้ไขรูป" : "เพิ่มรูป";
    const copy = byId("pd-copy-link");
    copy.setAttribute("aria-disabled", String(!has));
    copy.title = has
      ? many
        ? "คลิก: คัดลอกลิงก์รูปนี้ · คลิกขวา: คัดลอกลิงก์ทุกรูป"
        : "คัดลอกลิงก์รูปนี้"
      : "ยังไม่มีรูปให้คัดลอก";
    const drive = byId("pd-open-drive");
    drive.hidden = !has;
    if (has) {
      const result = links.normalizeImageLink(current());
      drive.href = result.value || current();
      drive.textContent = result.driveId ? "เปิดใน Google Drive ↗" : "เปิดรูปต้นฉบับ ↗";
    }
    const strip = byId("pd-thumbs"),
      thumbHadFocus = strip.contains(document.activeElement);
    strip.replaceChildren();
    strip.hidden = editing || !many;
    images.forEach((link, i) => {
      const button = el("button", `pd-thumb${i === index ? " is-selected" : ""}`);
      button.type = "button";
      button.setAttribute("aria-label", `รูปที่ ${i + 1}`);
      button.setAttribute("aria-pressed", String(i === index));
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.onerror = () => button.classList.add("is-broken");
      img.src = links.imageSource(link, 160);
      button.append(img);
      button.onclick = () => go(i);
      strip.append(button);
    });
    // Rebuilding the strip would drop focus out of the modal (and stop arrow keys); keep it on the selection.
    if (thumbHadFocus) strip.children[index]?.focus({ preventScroll: true });
    if (has) showImage();
    else {
      imageToken++;
      byId("pd-error").hidden = true;
      byId("pd-spinner").hidden = true;
    }
  }
  function go(next) {
    if (images.length < 2) return;
    index = (next + images.length) % images.length;
    renderMedia();
  }
  byId("pd-prev").onclick = () => go(index - 1);
  byId("pd-next").onclick = () => go(index + 1);
  byId("pd-frame").onclick = () => {
    if (!current() || !byId("pd-error").hidden) return;
    const img = byId("pd-lightbox-image");
    img.alt = byId("pd-image").alt;
    img.src = links.imageSource(current(), 2000);
    lightbox.showModal();
  };
  lightbox.addEventListener("click", () => lightbox.close());
  byId("pd-copy-link").onclick = () => {
    if (!current()) return;
    copyText(viewLink(current()), "คัดลอกลิงก์รูปแล้ว");
  };
  byId("pd-copy-link").addEventListener("contextmenu", (event) => {
    if (images.length < 2) return;
    event.preventDefault();
    copyText(images.map(viewLink).join("\n"), `คัดลอกลิงก์ทั้ง ${count(images.length)} รูปแล้ว`);
  });
  byId("pd-copy-code").onclick = () =>
    product && copyText(product.code, `คัดลอกรหัส ${product.code} แล้ว`);

  // ---------- link editor ----------
  const editorList = byId("pd-editor-list");
  const messages = {
    invalid: "ลิงก์ไม่ถูกต้อง ต้องเป็นลิงก์ Google Drive หรือขึ้นต้นด้วย https://",
    folder: "นี่คือลิงก์โฟลเดอร์ ต้องใช้ลิงก์ของไฟล์รูปทีละไฟล์",
    unreachable: "โหลดรูปไม่ได้ · ตรวจว่าแชร์เป็น 'ทุกคนที่มีลิงก์' และเป็นไฟล์รูป",
  };
  function checkRow(row) {
    const input = row.querySelector("input"),
      preview = row.querySelector(".pd-preview"),
      note = row.querySelector(".pd-row-note"),
      result = links.normalizeImageLink(input.value);
    // Each check gets a token; a slower image load from an older value can never overwrite a newer one.
    const token = (row.checkToken = (row.checkToken || 0) + 1);
    clearTimeout(row.checkTimer);
    preview.replaceChildren();
    const set = (state, text = "") => {
      row.dataset.state = state;
      note.textContent = text;
      input.setAttribute("aria-invalid", String(state === "error"));
    };
    if (result.reason === "empty") return set("empty");
    if (!result.ok) return set("error", messages[result.reason]);
    set("checking", "กำลังตรวจรูป…");
    row.checkTimer = setTimeout(() => {
      const probe = new Image();
      probe.alt = "";
      probe.onload = () => {
        if (token !== row.checkToken) return;
        preview.replaceChildren(probe);
        set("ok");
      };
      probe.onerror = () => {
        if (token !== row.checkToken) return;
        set("error", messages.unreachable);
      };
      probe.src = links.imageSource(input.value, 160);
    }, 300);
  }
  function editorRow(value = "") {
    const row = el("li", "pd-row"),
      preview = el("span", "pd-preview"),
      field = el("div", "pd-row-field"),
      input = el("input"),
      note = el("p", "pd-row-note"),
      tools = el("div", "pd-row-tools");
    preview.setAttribute("aria-hidden", "true");
    input.type = "text";
    input.inputMode = "url";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "ลิงก์ Google Drive หรือ https://…";
    input.value = value;
    input.addEventListener("input", () => {
      checkRow(row);
      editorStatus("");
    });
    note.id = `pd-note-${Math.random().toString(36).slice(2)}`;
    input.setAttribute("aria-describedby", note.id);
    field.append(input, note);
    const tool = (text, label, action) => {
      const button = el("button", "pd-icon-btn", text);
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.onclick = action;
      return button;
    };
    tools.append(
      tool("⧉", "คัดลอกลิงก์นี้", () => {
        const result = links.normalizeImageLink(input.value);
        if (result.ok) copyText(result.value, "คัดลอกลิงก์แล้ว");
        else toast("ยังไม่มีลิงก์ที่ถูกต้องให้คัดลอก");
      }),
      tool("↑", "เลื่อนขึ้น", () => {
        row.previousElementSibling?.before(row);
        refreshEditor();
        row.querySelector("input").focus();
      }),
      tool("↓", "เลื่อนลง", () => {
        row.nextElementSibling?.after(row);
        refreshEditor();
        row.querySelector("input").focus();
      }),
      tool("✕", "ลบลิงก์นี้", () => {
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        if (!editorList.children.length) editorList.append(editorRow());
        refreshEditor();
        (next || editorList.firstElementChild)?.querySelector("input").focus();
      }),
    );
    row.append(preview, field, tools);
    checkRow(row); // every row starts with a state (empty / error / checking)
    return row;
  }
  function refreshEditor() {
    const rows = [...editorList.children];
    rows.forEach((row, i) => {
      row.querySelector("input").setAttribute("aria-label", `ลิงก์รูปที่ ${i + 1}${i === 0 ? " (รูปหลัก)" : ""}`);
      row.classList.toggle("is-main", i === 0);
      const [, up, down] = row.querySelectorAll(".pd-icon-btn");
      up.disabled = i === 0;
      down.disabled = i === rows.length - 1;
    });
    byId("pd-editor-add").disabled = rows.length >= links.MAX_IMAGES;
  }
  function editorStatus(text, tone = "") {
    const box = byId("pd-editor-status");
    box.textContent = text;
    box.dataset.tone = tone;
  }
  function startEdit() {
    if (!canEdit || !product) return;
    editing = true;
    dialog.classList.add("is-editing");
    editorList.replaceChildren(...(images.length ? images : [""]).map((link) => editorRow(link)));
    refreshEditor();
    editorStatus("");
    byId("pd-editor").hidden = false;
    byId("pd-thumbs").hidden = true;
    byId("pd-edit").hidden = true;
    editorList.querySelector("input")?.focus();
  }
  function stopEdit() {
    editing = false;
    dialog.classList.remove("is-editing");
    byId("pd-editor").hidden = true;
    [...editorList.children].forEach((row) => {
      row.checkToken = (row.checkToken || 0) + 1;
      clearTimeout(row.checkTimer);
    });
    renderMedia();
    byId("pd-edit").focus();
  }
  async function saveEdit() {
    const rows = [...editorList.children],
      wrong = rows.filter((row) => row.dataset.state === "error").length,
      pending = rows.some((row) => row.dataset.state === "checking");
    if (wrong) return editorStatus(`ยังมีลิงก์ไม่ถูกต้อง ${count(wrong)} รายการ · แก้หรือลบก่อนบันทึก`, "error");
    if (pending) return editorStatus("กำลังตรวจรูป รอสักครู่แล้วกดบันทึกอีกครั้ง", "error");
    // Trim, drop empty rows and store Drive links in their standard form.
    const cleaned = rows
      .map((row) => links.normalizeImageLink(row.querySelector("input").value))
      .filter((result) => result.ok)
      .map((result) => result.value);
    const code = product.code,
      buttons = [byId("pd-editor-save"), byId("pd-editor-cancel")];
    buttons.forEach((button) => (button.disabled = true));
    editorStatus("กำลังบันทึก…");
    try {
      const saved = await saveImages(code, cleaned);
      if (!product || product.code !== code) return;
      images = saved;
      product.images = saved;
      index = 0;
      stopEdit();
      fillThumbs();
      flashSaved();
      toast("✓ แก้ไขแล้ว · ทุกคนเห็นรูปชุดนี้");
    } catch (error) {
      editorStatus(error.name === "TimeoutError" ? "บันทึกนานเกินไป กรุณาลองใหม่" : error.message, "error");
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  }
  function flashSaved() {
    const badge = el("span", "pd-saved", "✓ แก้ไขแล้ว");
    byId("pd-stage").append(badge);
    setTimeout(() => badge.remove(), 1800);
  }
  byId("pd-edit").onclick = startEdit;
  byId("pd-empty-add").onclick = startEdit;
  byId("pd-editor-cancel").onclick = stopEdit;
  byId("pd-editor-save").onclick = saveEdit;
  byId("pd-editor-add").onclick = () => {
    if (editorList.children.length >= links.MAX_IMAGES) return;
    const row = editorRow();
    editorList.append(row);
    refreshEditor();
    row.querySelector("input").focus();
  };
  editorList.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("input") && !event.isComposing) {
      event.preventDefault();
      saveEdit();
    }
  });

  // ---------- best-seller panel (needs the best_sellers permission) ----------
  // The viewer can hide the panel; the choice is a per-browser convenience only.
  const HIDE_KEY = "pd-bestseller-hidden";
  let bestHidden = false;
  try { bestHidden = localStorage.getItem(HIDE_KEY) === "1"; } catch {}
  function bestTitle() {
    const head = el("div", "detail-bestseller-head"),
      toggle = el("button", "pd-best-toggle", bestHidden ? "แสดง ▾" : "ซ่อน ▴");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!bestHidden));
    toggle.onclick = () => {
      bestHidden = !bestHidden;
      try { localStorage.setItem(HIDE_KEY, bestHidden ? "1" : "0"); } catch {}
      byId("detail-bestseller").classList.toggle("is-collapsed", bestHidden);
      toggle.textContent = bestHidden ? "แสดง ▾" : "ซ่อน ▴";
      toggle.setAttribute("aria-expanded", String(!bestHidden));
    };
    head.append(bestTitle(), toggle);
    byId("detail-bestseller").classList.toggle("is-collapsed", bestHidden);
    return head;
  }  const baht = (value) =>
    blank(value)
      ? "—"
      : Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  async function loadBestSeller(code) {
    const panel = byId("detail-bestseller"),
      id = ++bestSellerRequest;
    panel.replaceChildren(
      bestTitle(),
      el("p", "detail-bestseller-state", "กำลังดึงอันดับขายดีจาก SML…"),
    );
    try {
      const response = await fetch("/api/products/best-seller?" + new URLSearchParams({ code }), {
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (id !== bestSellerRequest) return;
      panel.replaceChildren(bestTitle());
      if (!data.sold) {
        panel.append(el("p", "detail-bestseller-state", "สินค้านี้ยังไม่มีรายการขายในระบบ จึงไม่ติดอันดับขายดี"));
        return;
      }
      const standing = (label, place) =>
        place ? [label, `อันดับ ${count(place.rank)} จาก ${count(place.total)}`] : [label, "ไม่ติดอันดับ"];
      const grid = el("div", "detail-bestseller-grid");
      for (const [label, value] of [
        standing("อันดับขายดีทั้งหมด", data.all),
        standing("อันดับขายดี 3 เดือนล่าสุด", data.recent),
        ["ยอดขายสุทธิทั้งหมด (บาท)", baht(data.netAll)],
        ["ยอดขายสุทธิ 3 เดือน (บาท)", baht(data.netRecent)],
        ["ขายล่าสุด", data.lastSold ?? "—"],
        ["ใบขาย · ลูกค้า", `${count(data.invoices ?? 0)} ใบ · ${count(data.buyers ?? 0)} ราย`],
      ]) {
        const card = el("article", "product-detail-metric");
        if (label.startsWith("อันดับ") && value !== "ไม่ติดอันดับ") card.classList.add("status-info");
        card.append(el("span", "", label), el("strong", "", value));
        grid.append(card);
      }
      panel.append(
        grid,
        el(
          "p",
          "detail-bestseller-note",
          "อันดับคิดจากยอดขายสุทธิทั้งทะเบียน (ขาย + เพิ่มหนี้ − รับคืน) ไม่ขึ้นกับตัวกรองในตาราง · ไม่รวมสินค้าฝากขาย",
        ),
      );
    } catch (error) {
      if (id !== bestSellerRequest) return;
      panel.replaceChildren(
        bestTitle(),
        el(
          "p",
          "detail-bestseller-state error",
          error.name === "TimeoutError" ? "ดึงอันดับขายดีนานเกินไป กรุณาปิดแล้วเปิดใหม่" : error.message,
        ),
      );
    }
  }

  // ---------- open / close ----------
  function open(row, trigger) {
    dialog.querySelectorAll(".pd-saved").forEach((badge) => badge.remove()); // belongs to the previous product
    product = mapProduct(row);
    opener = trigger || document.activeElement;
    images = product.images.slice();
    index = 0;
    editing = false;
    dialog.classList.remove("is-editing");
    byId("pd-editor").hidden = true;
    renderInfo();
    renderMedia();
    document.documentElement.classList.add("pd-scroll-lock");
    dialog.showModal();
    dialog.scrollTop = 0;
    byId("close-detail").focus({ preventScroll: true });
    if (canRank) loadBestSeller(product.code);
    else byId("detail-bestseller").replaceChildren();
    // Refresh this product's links (someone else may have edited them since the table loaded).
    const request = ++detailRequest,
      code = product.code;
    fetchImages([code])
      .then(() => {
        if (request !== detailRequest || !dialog.open || editing || product?.code !== code) return;
        const fresh = imageCache.get(code) || [];
        if (fresh.join("\n") !== images.join("\n")) {
          images = fresh.slice();
          index = 0;
        }
        renderMedia();
        fillThumbs();
      })
      .catch(() => {});
  }
  window.ProductDetail = { open };

  byId("close-detail").onclick = () => dialog.close();
  byId("detail-x").onclick = () => dialog.close();
  // Esc while editing cancels the edit instead of closing the modal.
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      event.stopPropagation();
      stopEdit();
      return;
    }
    if (editing || event.target.matches("input, textarea, select")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (editing) {
      event.preventDefault();
      stopEdit();
    }
  });
  // Backdrop click closes; a press that starts inside the modal and ends outside (text drag) does not.
  let backdropPress = false;
  const outside = (event) => {
    const box = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
    );
  };
  dialog.addEventListener("pointerdown", (event) => {
    backdropPress = event.button === 0 && outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (backdropPress && outside(event)) dialog.close();
    backdropPress = false;
  });
  dialog.addEventListener("pointercancel", () => (backdropPress = false));
  dialog.addEventListener("close", () => {
    backdropPress = false;
    bestSellerRequest++;
    detailRequest++;
    imageToken++;
    if (editing) {
      editing = false;
      dialog.classList.remove("is-editing");
      byId("pd-editor").hidden = true;
    }
    if (lightbox.open) lightbox.close();
    dialog.querySelectorAll(".pd-saved").forEach((badge) => badge.remove());
    document.documentElement.classList.remove("pd-scroll-lock");
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
})();
