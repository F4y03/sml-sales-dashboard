// ลูกค้า & สต็อก: three tabs on read-only SML data (see customer-stock.js on the server).
(() => {
  const el = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
  const thDate = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
  const baht = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : `฿${money.format(Number(v))}`);
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : qty.format(Number(v)));
  const day = (v) => (v ? thDate.format(new Date(`${v}T12:00:00`)) : "—");
  const daysSince = (v) => (v ? Math.round((Date.now() - Date.parse(`${v}T12:00:00`)) / 86400000) : null);
  const FLAG = { 44: ["ขาย", "sale"], 46: ["เพิ่มหนี้", "added"], 48: ["รับคืน / ลดหนี้", "return"] };
  const node = (tag, text = "", className = "") => {
    const n = document.createElement(tag);
    if (text !== "") n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  const badge = (flag) => {
    const [label, tone] = FLAG[flag] || [`เอกสาร ${flag}`, ""];
    return node("span", label, `cs2-badge ${tone}`);
  };
  const status = (id, text, error = false) => {
    el(id).textContent = text;
    el(id).classList.toggle("error", error);
  };
  async function getJSON(url, signal) {
    const response = await fetch(url, { cache: "no-store", signal, headers: { Accept: "application/json" } });
    let data = null;
    try { data = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !data) throw new Error(data?.error || (response.status === 403 ? "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" : "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่"));
    return data;
  }
  const errorText = (e) => (e.message === "Failed to fetch" ? "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่" : e.message);

  // ---------- tabs (remembered in the URL hash) ----------
  const tabs = { history: "tab-history", stock: "tab-stock", movement: "tab-movement" };
  const loaded = new Set();
  function showTab(name, focus = false) {
    if (!tabs[name]) name = "history";
    for (const [key, id] of Object.entries(tabs)) {
      const on = key === name;
      el(id).setAttribute("aria-selected", String(on));
      el(id).tabIndex = on ? 0 : -1;
      el(`panel-${key}`).hidden = !on;
    }
    if (focus) el(tabs[name]).focus();
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    if (name === "stock" && !loaded.has("stock")) { loaded.add("stock"); loadStock(); }
  }
  Object.entries(tabs).forEach(([key, id], index, all) => {
    el(id).addEventListener("click", () => showTab(key));
    el(id).addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      showTab(all[(index + step + all.length) % all.length][0], true);
    });
  });

  // ---------- shared search-as-you-type picker ----------
  function picker({ input, list, statusId, url, key, render, onPick }) {
    let timer, controller, items = [];
    const close = () => { list.hidden = true; list.replaceChildren(); };
    const search = async () => {
      const q = input.value.trim();
      controller?.abort();
      if (q.length < 1) { close(); status(statusId, ""); return; }
      controller = new AbortController();
      status(statusId, "กำลังค้นหา…");
      try {
        const data = await getJSON(`${url}?${new URLSearchParams({ q })}`, controller.signal);
        items = data[key];
        list.replaceChildren();
        if (!items.length) { close(); status(statusId, "ไม่พบรายการที่ตรงกับคำค้นหา"); return; }
        items.forEach((item, i) => {
          const li = node("li");
          li.setAttribute("role", "option");
          const button = node("button");
          button.type = "button";
          const [main, side] = render(item);
          button.append(node("span", main), node("small", side));
          button.addEventListener("click", () => { close(); status(statusId, ""); onPick(item); });
          button.addEventListener("keydown", (e) => {
            const buttons = [...list.querySelectorAll("button")];
            if (e.key === "ArrowDown") { e.preventDefault(); buttons[Math.min(i + 1, buttons.length - 1)].focus(); }
            if (e.key === "ArrowUp") { e.preventDefault(); (i ? buttons[i - 1] : input).focus(); }
            if (e.key === "Escape") { close(); input.focus(); }
          });
          li.append(button);
          list.append(li);
        });
        list.hidden = false;
        status(statusId, items.length === 30 ? "แสดง 30 รายการแรก พิมพ์ให้เจาะจงขึ้นเพื่อหาเพิ่ม" : `พบ ${items.length} รายการ`);
      } catch (e) {
        if (e.name === "AbortError") return;
        close();
        status(statusId, errorText(e), true);
      }
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && !list.hidden) { e.preventDefault(); list.querySelector("button")?.focus(); }
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); search(); }
      if (e.key === "Escape") close();
    });
    document.addEventListener("click", (e) => { if (!list.contains(e.target) && e.target !== input) close(); });
  }

  // ---------- Tab 1: customer history ----------
  let customer = null, billPage = 0, billController;
  picker({
    input: el("customer-search"), list: el("customer-results"), statusId: "customer-search-status",
    url: "/api/customer-stock/customers", key: "customers",
    render: (c) => [c.name, c.code],
    onPick: (c) => { el("customer-search").value = `${c.name} · ${c.code}`; customer = c.code; billPage = 0; loadHistory(); },
  });
  async function loadHistory() {
    billController?.abort();
    billController = new AbortController();
    el("history-empty").hidden = true;
    el("history-view").hidden = false;
    status("history-status", "กำลังโหลดประวัติจาก SML…");
    el("bill-rows").replaceChildren();
    try {
      const data = await getJSON(`/api/customer-stock/customer?${new URLSearchParams({ code: customer, page: billPage })}`, billController.signal);
      const s = data.summary;
      el("history-name").textContent = data.customer?.name || customer;
      el("history-code").textContent = `รหัสลูกค้า ${customer}`;
      el("history-net").textContent = baht(s.net);
      el("history-invoices").textContent = `${num(s.invoices)} บิล`;
      el("history-docs").textContent = `เอกสารทั้งหมด ${num(s.documents)} ใบ`;
      el("history-first").textContent = day(s.first);
      el("history-last").textContent = day(s.last);
      const ago = daysSince(s.last);
      el("history-last-ago").textContent = ago == null ? "ยังไม่เคยมีบิลขาย" : ago === 0 ? "วันนี้" : `${num(ago)} วันที่แล้ว`;
      el("history-returns").textContent = baht(s.returns);
      el("history-added").textContent = `เพิ่มหนี้ ${baht(s.added)}`;
      renderBills(data.bills);
      const pages = Math.max(1, Math.ceil(s.documents / data.pageSize));
      el("bills-page").textContent = `หน้า ${billPage + 1} / ${pages}`;
      el("bills-prev").disabled = billPage === 0;
      el("bills-next").disabled = billPage + 1 >= pages;
      status("history-status", s.documents ? `อัปเดต ${new Date(data.updatedAt).toLocaleTimeString("th-TH")}` : "ลูกค้ารายนี้ยังไม่มีบิลขาย เพิ่มหนี้ หรือรับคืน");
    } catch (e) {
      if (e.name === "AbortError") return;
      status("history-status", errorText(e), true);
      el("bills-prev").disabled = el("bills-next").disabled = true;
    }
  }
  function renderBills(bills) {
    const body = el("bill-rows");
    body.replaceChildren();
    if (!bills.length) {
      const tr = node("tr"), td = node("td", "ไม่มีเอกสารในหน้านี้", "muted");
      td.colSpan = 6; tr.append(td); body.append(tr);
      return;
    }
    for (const bill of bills) {
      const tr = node("tr", "", "bill-row");
      tr.tabIndex = 0;
      tr.setAttribute("aria-expanded", "false");
      const amount = node("td", baht(bill.flag === 48 ? -bill.amount : bill.amount), `num${bill.flag === 48 ? " neg" : ""}`);
      const type = node("td"); type.append(badge(bill.flag));
      tr.append(node("td", day(bill.date)), node("td", bill.docNo), type, node("td", bill.saleCode || "—", bill.saleCode ? "" : "muted"), amount, node("td", "▸", "toggle"));
      const toggle = () => toggleBill(tr, bill);
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      body.append(tr);
    }
  }
  async function toggleBill(tr, bill) {
    const open = tr.getAttribute("aria-expanded") === "true";
    if (open) { tr.nextElementSibling?.remove(); tr.setAttribute("aria-expanded", "false"); tr.lastChild.textContent = "▸"; return; }
    tr.setAttribute("aria-expanded", "true");
    tr.lastChild.textContent = "▾";
    const detail = node("tr", "", "bill-lines"), cell = node("td");
    cell.colSpan = 6;
    cell.append(node("p", "กำลังโหลดรายการสินค้า…", "cs2-status"));
    detail.append(cell);
    tr.after(detail);
    try {
      const { lines } = await getJSON(`/api/customer-stock/bill?${new URLSearchParams({ docNo: bill.docNo, date: bill.date, flag: bill.flag, customer })}`);
      if (!detail.isConnected) return;
      if (!lines.length) { cell.replaceChildren(node("p", "ไม่พบรายการสินค้าในเอกสารนี้", "cs2-status")); return; }
      const table = node("table", "", "cs2-lines");
      const head = node("tr");
      ["รหัสสินค้า", "ชื่อสินค้า", "จำนวน", "หน่วย", "ยอด"].forEach((h, i) => head.append(node("th", h, i === 2 || i === 4 ? "num" : "")));
      table.append(node("thead"));
      table.tHead.append(head);
      const tbody = node("tbody");
      let total = 0;
      for (const line of lines) {
        total += Number(line.amount) || 0;
        const row = node("tr");
        row.append(node("td", line.code), node("td", line.name), node("td", num(line.quantity), "num"), node("td", line.unit || "—"), node("td", baht(line.amount), "num"));
        tbody.append(row);
      }
      table.append(tbody);
      const foot = node("tfoot"), sum = node("tr"), label = node("td", `รวมรายการ ${lines.length} บรรทัด (ยอดท้ายบิล ${baht(bill.amount)} อาจต่างจากผลรวมรายการเพราะส่วนลด/VAT)`);
      label.colSpan = 4;
      sum.append(label, node("td", baht(total), "num"));
      foot.append(sum);
      table.append(foot);
      cell.replaceChildren(table);
    } catch (e) {
      if (detail.isConnected) cell.replaceChildren(node("p", errorText(e), "cs2-status error"));
    }
  }
  el("bills-prev").addEventListener("click", () => { billPage = Math.max(0, billPage - 1); loadHistory(); });
  el("bills-next").addEventListener("click", () => { billPage += 1; loadHistory(); });

  // ---------- Tab 2: whole stock ----------
  let stockPage = 0, stockController, stockTimer;
  async function loadStock() {
    stockController?.abort();
    stockController = new AbortController();
    status("stock-status", "กำลังคำนวณมูลค่าสต็อกจาก SML…");
    el("stock-prev").disabled = el("stock-next").disabled = true;
    try {
      const params = { q: el("stock-search").value.trim(), filter: el("stock-filter").value, sort: el("stock-sort").value, page: stockPage };
      const data = await getJSON(`/api/customer-stock/stock?${new URLSearchParams(params)}`, stockController.signal);
      const s = data.summary;
      el("stock-value").textContent = baht(s.value);
      el("stock-in").textContent = `${num(s.inStock)} รายการ`;
      el("stock-total").textContent = `จากสินค้าในทะเบียน ${num(s.products)} รายการ`;
      el("stock-noprice").textContent = `${num(s.inStockNoPrice)} รายการ`;
      el("stock-negative").textContent = `${num(s.negative)} รายการ`;
      el("stock-nodata").textContent = `${num(s.noStockData)} รายการ`;
      const body = el("stock-rows");
      body.replaceChildren();
      if (!data.rows.length) {
        const tr = node("tr"), td = node("td", "ไม่พบสินค้าตามตัวกรอง", "muted");
        td.colSpan = 7; tr.append(td); body.append(tr);
      }
      for (const r of data.rows) {
        const tr = node("tr");
        const q = r.quantity == null ? node("td", "ไม่มีข้อมูล", "num muted") : node("td", num(r.quantity), `num${Number(r.quantity) < 0 ? " neg" : ""}`);
        tr.append(node("td", r.code), node("td", r.name || "—"), node("td", r.group || "—", r.group ? "" : "muted"), q, node("td", r.unit || "—"),
          node("td", r.price == null ? "ไม่มีราคา" : baht(r.price), `num${r.price == null ? " muted" : ""}`),
          node("td", r.value == null ? "—" : baht(r.value), `num${r.value == null ? " muted" : ""}`));
        body.append(tr);
      }
      const pages = Math.max(1, Math.ceil(data.matching.count / data.pageSize));
      el("stock-page").textContent = `หน้า ${stockPage + 1} / ${pages}`;
      el("stock-prev").disabled = stockPage === 0;
      el("stock-next").disabled = stockPage + 1 >= pages;
      status("stock-status", `ตรงตัวกรอง ${num(data.matching.count)} รายการ · มูลค่า ${baht(data.matching.value)} · อัปเดต ${new Date(data.updatedAt).toLocaleTimeString("th-TH")}`);
    } catch (e) {
      if (e.name === "AbortError") return;
      status("stock-status", errorText(e), true);
    }
  }
  const restartStock = () => { stockPage = 0; loadStock(); };
  el("stock-search").addEventListener("input", () => { clearTimeout(stockTimer); stockTimer = setTimeout(restartStock, 300); });
  el("stock-filter").addEventListener("change", restartStock);
  el("stock-sort").addEventListener("change", restartStock);
  el("stock-filters").addEventListener("submit", (e) => { e.preventDefault(); restartStock(); });
  el("stock-prev").addEventListener("click", () => { stockPage = Math.max(0, stockPage - 1); loadStock(); });
  el("stock-next").addEventListener("click", () => { stockPage += 1; loadStock(); });

  // ---------- Tab 3: product movement ----------
  let movement = null, movementController, cyclesShown = 0, movesShown = 0;
  picker({
    input: el("product-search"), list: el("product-results"), statusId: "product-search-status",
    url: "/api/customer-stock/products", key: "products",
    render: (p) => [p.name, `${p.code} · คงเหลือ ${p.quantity == null ? "ไม่มีข้อมูล" : num(p.quantity)} ${p.unit || ""}`],
    onPick: (p) => { el("product-search").value = `${p.name} · ${p.code}`; loadMovement(p.code); },
  });
  async function loadMovement(code) {
    movementController?.abort();
    movementController = new AbortController();
    el("movement-empty").hidden = true;
    el("movement-view").hidden = false;
    el("cycle-list").replaceChildren();
    el("move-rows").replaceChildren();
    el("cycles-more").hidden = el("moves-more").hidden = true;
    status("movement-status", "กำลังโหลดความเคลื่อนไหวจาก SML…");
    try {
      movement = await getJSON(`/api/customer-stock/movement?${new URLSearchParams({ code })}`, movementController.signal);
      const { product, cycles, moves } = movement;
      const unit = product.unit || "";
      el("movement-name").textContent = product.name;
      el("movement-code").textContent = `รหัสสินค้า ${product.code}${unit ? ` · หน่วย ${unit}` : ""}`;
      el("movement-balance").textContent = product.quantity == null ? "ไม่มีข้อมูล" : `${num(product.quantity)} ${unit}`;
      const computed = movement.computedBalance == null ? null : Number(movement.computedBalance);
      el("movement-check").textContent = computed == null
        ? "ยังไม่มีความเคลื่อนไหว"
        : product.quantity != null && Math.abs(computed - Number(product.quantity)) < 0.005
          ? "ตรงกับยอดรวมความเคลื่อนไหว ✓"
          : `ยอดจากความเคลื่อนไหว ${num(computed)} ไม่ตรงทะเบียน`;
      el("movement-cycles").textContent = `${num(cycles.length)} รอบ`;
      const done = cycles.filter((c) => c.days != null);
      el("movement-avg").textContent = done.length ? `${num(done.reduce((s, c) => s + c.days, 0) / done.length)} วัน` : "—";
      el("movement-count").textContent = `${num(moves.length)} รายการ`;
      cyclesShown = 0; movesShown = 0;
      if (!cycles.length) el("cycle-list").append(node("p", moves.length ? "ยังไม่เคยมีรอบที่คงเหลือขึ้นจาก 0" : "สินค้านี้ยังไม่มีความเคลื่อนไหวที่กระทบสต็อก", "cs2-status"));
      renderCycles(unit);
      renderMoves(unit);
      status("movement-status", `อัปเดต ${new Date(movement.updatedAt).toLocaleTimeString("th-TH")}`);
    } catch (e) {
      if (e.name === "AbortError") return;
      status("movement-status", errorText(e), true);
    }
  }
  function renderCycles(unit) {
    const next = movement.cycles.slice(cyclesShown, cyclesShown + 5);
    cyclesShown += next.length;
    for (const c of next) {
      const card = node("article", "", "cs2-cycle");
      const inStep = node("div", "", "cs2-step in");
      inStep.append(node("span", "① วันเข้า"), node("strong", day(c.start)),
        node("small", `เอกสาร ${c.startDoc} · รับเข้าในรอบนี้ ${num(c.received)} ${unit} (${num(c.receipts)} ครั้ง)`));
      const buyStep = node("div", "", "cs2-step");
      buyStep.append(node("span", `② ใครซื้อ · ${num(c.buyers.length)} ราย · ขาย ${num(c.sold)} ${unit}`));
      if (c.buyers.length) {
        const list = node("ul", "", "cs2-buyers");
        for (const b of c.buyers) {
          const li = node("li"), who = node("span", b.name);
          who.append(node("small", `${b.code || "ไม่ระบุรหัส"} · ${num(b.bills)} บิล · ${day(b.first)}${b.last !== b.first ? ` – ${day(b.last)}` : ""}`));
          li.append(who, node("b", `${num(b.quantity)} ${unit}`));
          list.append(li);
        }
        buyStep.append(list);
      } else buyStep.append(node("small", "ไม่มีบิลขายในรอบนี้ (ออกด้วยเอกสารประเภทอื่น หรือยังไม่ได้ขาย)"));
      const outStep = node("div", "", `cs2-step ${c.end ? "out" : "open"}`);
      if (c.end) outStep.append(node("span", "③ วันหมด"), node("strong", day(c.end)), node("small", `เอกสาร ${c.endDoc} · อยู่ในสต็อก ${num(c.days)} วัน`));
      else {
        const left = movement.computedBalance == null ? null : Number(movement.computedBalance);
        outStep.append(node("span", "③ ยังไม่หมด"), node("strong", `เหลือ ${num(left)} ${unit}`), node("small", `เข้ามาแล้ว ${num(daysSince(c.start))} วัน`));
      }
      card.append(inStep, buyStep, outStep);
      el("cycle-list").append(card);
    }
    el("cycles-more").hidden = cyclesShown >= movement.cycles.length;
  }
  function renderMoves(unit) {
    const next = movement.moves.slice(movesShown, movesShown + 100);
    movesShown += next.length;
    for (const m of next) {
      const tr = node("tr"), type = node("td");
      const direction = Number(m.direction);
      type.append(FLAG[m.flag] ? badge(m.flag) : node("span", `${direction === 1 ? "รับเข้า" : "เบิกออก"} · เอกสาร ${m.flag}`, "cs2-badge"));
      const inQty = direction === 1 ? num(m.quantity) : "", outQty = direction === -1 ? num(m.quantity) : "";
      tr.append(node("td", day(m.date)), node("td", m.docNo), type,
        node("td", m.customerName || "—", m.customerName ? "" : "muted"),
        node("td", inQty, "num pos"), node("td", outQty, "num neg"),
        node("td", `${num(m.balance)} ${unit}`, `num${Number(m.balance) < 0 ? " neg" : ""}`));
      el("move-rows").append(tr);
    }
    el("moves-more").hidden = movesShown >= movement.moves.length;
  }
  el("cycles-more").addEventListener("click", () => renderCycles(movement.product.unit || ""));
  el("moves-more").addEventListener("click", () => renderMoves(movement.product.unit || ""));

  showTab(location.hash.slice(1));
})();
