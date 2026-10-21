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
    if (name === "movement") startMovementTab();
    if (name === "history") fitTeamList();
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
  const pickCustomer = (c) => {
    customer = c.code;
    billPage = 0;
    markTeamCustomer();
    loadHistory();
  };
  picker({
    input: el("customer-search"), list: el("customer-results"), statusId: "customer-search-status",
    url: "/api/customer-stock/customers", key: "customers",
    render: (c) => [c.name, c.code],
    onPick: (c) => { el("customer-search").value = `${c.name} · ${c.code}`; pickCustomer(c); },
  });

  // Browse by salesperson (ar_customer_detail.sale_code — same source and labels as Customer Insights).
  const TEAM_NAMES = {
    หย: "เหนือ", วย: "ตะวันออก", "กท-ต": "กรุงเทพ-ติ้ก", อย: "อีสาน", กภ: "กรุงเทพ",
    ลภ: "กลาง", ตช: "ใต้", "กท-ร": "กรุงเทพ-รุ่ง", "กท-ณ": "กรุงเทพ-บริษัท1", บอ: "กรุงเทพ-บริษัท2",
  };
  const teamLabel = (code) => (!code ? "ไม่ระบุพนักงานขาย" : TEAM_NAMES[code] ? `${TEAM_NAMES[code]} (${code})` : code);
  let allCustomers = [];
  async function loadTeams() {
    const select = el("team-select");
    try {
      allCustomers = (await getJSON("/api/customer-stock/customer-list")).customers;
      const counts = new Map();
      for (const c of allCustomers) counts.set(c.saleCode, (counts.get(c.saleCode) || 0) + 1);
      const codes = [...counts.keys()].sort((a, b) => (!a) - (!b) || teamLabel(a).localeCompare(teamLabel(b), "th"));
      select.replaceChildren(new Option("เลือกพนักงานขาย", ""));
      for (const code of codes) select.append(new Option(`${teamLabel(code)} · ${num(counts.get(code))} ราย`, code || "-"));
      select.disabled = false;
    } catch (e) {
      select.replaceChildren(new Option("โหลดรายชื่อไม่สำเร็จ", ""));
      status("customer-search-status", `${errorText(e)} · ยังค้นหาลูกค้าด้วยชื่อหรือรหัสได้`, true);
    }
  }
  function renderTeam() {
    const value = el("team-select").value;
    el("team-panel").hidden = !value;
    if (!value) return;
    const code = value === "-" ? "" : value;
    const q = el("team-filter").value.trim().toLocaleLowerCase("th-TH");
    const members = allCustomers
      .filter((c) => c.saleCode === code && `${c.code}\n${c.name}`.toLocaleLowerCase("th-TH").includes(q))
      // Most recent buyers first; customers who never bought go last.
      .sort((a, b) => (b.lastPurchase || "").localeCompare(a.lastPurchase || "") || a.code.localeCompare(b.code, "th"));
    el("team-title").textContent = `${teamLabel(code)} · ${num(members.length)} ราย`;
    const list = el("team-customers");
    list.replaceChildren();
    if (!members.length) list.append(node("li", q ? "ไม่พบลูกค้าที่ตรงกับคำกรอง" : "ไม่มีลูกค้าในกลุ่มนี้", "cs2-status"));
    for (const c of members) {
      const li = node("li"), button = node("button");
      button.type = "button";
      button.dataset.code = c.code;
      button.append(node("span", c.name),
        node("small", `${c.code} · ${c.lastPurchase ? `ซื้อล่าสุด ${day(c.lastPurchase)} · ${num(c.invoices)} บิล` : "ยังไม่เคยมีบิลขาย"}`));
      button.addEventListener("click", () => { el("customer-search").value = ""; pickCustomer(c); });
      li.append(button);
      list.append(li);
    }
    fitTeamList();
    markTeamCustomer();
  }
  // Show exactly 8 customers; the rest scroll inside the list.
  const TEAM_ROWS = 8;
  const fitTeamList = () => fitRows(el("team-customers"));
  // Cap a list at TEAM_ROWS visible rows; skipped while the list is hidden (it has no size to measure).
  function fitRows(list) {
    if (!list.offsetParent) return;
    const rows = list.children;
    list.style.maxHeight = "";
    if (rows.length <= TEAM_ROWS) return;
    const first = rows[0].getBoundingClientRect(), last = rows[TEAM_ROWS - 1].getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
    list.style.maxHeight = `${Math.ceil(last.bottom - first.top + pad * 2)}px`;
  }
  window.addEventListener("resize", () => { if (!el("team-panel").hidden) fitTeamList(); });
  function markTeamCustomer() {
    el("team-customers").querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.code === customer)));
  }
  el("team-select").addEventListener("change", () => { el("team-filter").value = ""; renderTeam(); });
  el("team-filter").addEventListener("input", renderTeam);
  loadTeams();
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
      const name = data.customer?.name || customer;
      el("history-name").textContent = name;
      // First consonant/letter of the name (skip prefixes like ร้าน/บริษัท and leading Thai vowels เ แ โ ใ ไ).
      el("history-avatar").textContent = (name.replace(/^(ร้าน|บริษัท|หจก\.?|บจก\.?)\s*/, "").match(/[ก-ฮA-Za-z0-9]/) || ["?"])[0].toUpperCase();
      el("history-code").textContent = `รหัส ${customer}`;
      const team = allCustomers.find((c) => c.code === customer)?.saleCode;
      el("history-team").hidden = team == null;
      el("history-team").textContent = team == null ? "" : `พนักงานขาย ${teamLabel(team)}`;
      el("history-net").textContent = baht(s.net);
      el("history-sales").textContent = baht(s.sales);
      el("history-added").textContent = baht(s.added);
      el("history-returns").textContent = s.returns ? baht(-s.returns) : baht(0);
      el("history-invoices").textContent = `${num(s.invoices)} บิล`;
      el("history-docs").textContent = `เอกสารทั้งหมด ${num(s.documents)} ใบ`;
      el("history-avg").textContent = s.invoices ? baht(s.sales / s.invoices) : "—";
      el("history-first").textContent = day(s.first);
      const tenure = daysSince(s.first);
      el("history-tenure").textContent = tenure == null ? "ยังไม่เคยมีบิลขาย" : `เป็นลูกค้ามา ${tenure >= 365 ? `${num(Math.floor(tenure / 365))} ปี ${num(Math.floor((tenure % 365) / 30))} เดือน` : `${num(tenure)} วัน`}`;
      el("history-last").textContent = day(s.last);
      const ago = daysSince(s.last);
      el("history-last-ago").textContent = ago == null ? "ยังไม่เคยมีบิลขาย" : ago === 0 ? "วันนี้" : `${num(ago)} วันที่แล้ว`;
      // Recency chip: a plain-language reading of the last sales bill, not a business rule.
      const recency = el("history-recency");
      recency.hidden = false;
      // This customer's own data period: first to latest sale bill.
      recency.className = "cs2-chip";
      recency.textContent = s.first ? `ข้อมูล ${day(s.first)} – ${day(s.last)}` : "ยังไม่มีบิลขาย";
      renderTrend(data.monthly || []);
      renderBills(data.bills);
      billPages = Math.max(1, Math.ceil(s.documents / data.pageSize));
      const from = s.documents ? billPage * data.pageSize + 1 : 0, to = Math.min(s.documents, (billPage + 1) * data.pageSize);
      el("bills-range").textContent = s.documents ? `${num(from)}–${num(to)} จาก ${num(s.documents)} เอกสาร · กดบิลเพื่อดูรายการสินค้า` : "";
      el("bills-page").textContent = `หน้า ${num(billPage + 1)} / ${num(billPages)}`;
      el("bills-first").disabled = el("bills-prev").disabled = billPage === 0;
      el("bills-last").disabled = el("bills-next").disabled = billPage + 1 >= billPages;
      status("history-status", s.documents ? `อัปเดต ${new Date(data.updatedAt).toLocaleTimeString("th-TH")}` : "ลูกค้ารายนี้ยังไม่มีบิลขาย เพิ่มหนี้ หรือรับคืน");
    } catch (e) {
      if (e.name === "AbortError") return;
      status("history-status", errorText(e), true);
      el("bills-first").disabled = el("bills-prev").disabled = el("bills-next").disabled = el("bills-last").disabled = true;
    }
  }
  const monthName = new Intl.DateTimeFormat("th-TH", { month: "short" });
  const monthYear = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });
  function renderTrend(months) {
    const chart = el("history-trend");
    chart.replaceChildren();
    const max = Math.max(0, ...months.map((m) => Math.abs(Number(m.net) || 0)));
    const active = months.filter((m) => m.invoices > 0).length;
    el("trend-note").textContent = months.length ? `มีบิลขาย ${num(active)} จาก ${num(months.length)} เดือน` : "";
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `ยอดซื้อรายเดือน มีบิลขาย ${active} จาก ${months.length} เดือน`);
    months.forEach((m, i) => {
      const value = Number(m.net) || 0, date = new Date(`${m.month}-15T12:00:00`);
      const bar = node("div", "", `cs2-bar${!value ? " empty" : value < 0 ? " negative" : ""}`);
      bar.tabIndex = 0;
      const fill = node("i");
      fill.style.height = `${max ? Math.max(2, (Math.abs(value) / max) * 100) : 2}%`;
      bar.append(fill, node("span", `${monthYear.format(date)} · ${baht(value)} · ${num(m.invoices)} บิล`, "tip"));
      // Label every 3rd month (always including the current one); January also shows the year.
      if (i % 3 === (months.length - 1) % 3)
        bar.append(node("small", date.getMonth() === 0 ? `${monthName.format(date)} ${String(date.getFullYear() + 543).slice(2)}` : monthName.format(date)));
      chart.append(bar);
    });
  }
  const COLS = 4; // date | document | amount | chevron
  const shortMonth = new Intl.DateTimeFormat("th-TH", { month: "short", year: "2-digit" });
  function renderBills(bills) {
    const body = el("bill-rows");
    body.replaceChildren();
    if (!bills.length) {
      const tr = node("tr"), td = node("td", "ไม่มีเอกสารในหน้านี้", "cs2-status");
      td.colSpan = COLS; tr.append(td); body.append(tr);
      return;
    }
    let month = null;
    for (const bill of bills) {
      // A thin month divider whenever the month changes (no repeated totals).
      if (bill.date.slice(0, 7) !== month) {
        month = bill.date.slice(0, 7);
        const tr = node("tr", "", "month-row"), td = node("td", monthYear.format(new Date(`${month}-15T12:00:00`)));
        td.colSpan = COLS;
        tr.append(td);
        body.append(tr);
      }
      appendBill(body, bill);
    }
  }
  function appendBill(body, bill) {
    const signed = bill.flag === 48 ? -bill.amount : Number(bill.amount);
    const tr = node("tr", "", `bill-row${signed === 0 ? " zero" : ""}`);
    tr.tabIndex = 0;
    tr.setAttribute("aria-haspopup", "dialog");
    const date = new Date(`${bill.date}T12:00:00`);
    const when = node("td", "", "when"), box = node("div", "", "date-box");
    box.append(node("b", String(date.getDate())), node("small", shortMonth.format(date)));
    when.append(box);
    const doc = node("td", "", "doc-cell"), top = node("div", "", "doc-top"), meta = node("div", "", "doc-meta");
    top.append(node("span", bill.docNo, "doc"), badge(bill.flag));
    meta.textContent = `${day(bill.date)} · ${bill.saleCode ? teamLabel(bill.saleCode) : "ไม่ระบุพนักงานขาย"}`;
    doc.append(top, meta);
    const amount = node("td", baht(signed), `amount${signed < 0 ? " neg" : ""}`);
    const chevron = node("td", "", "toggle");
    chevron.append(node("span", "›", "chev"));
    tr.append(when, doc, amount, chevron);
    tr.setAttribute("aria-label", `${bill.docNo} ${day(bill.date)} ${baht(signed)} กดเพื่อดูรายการสินค้า`);
    const open = () => openBill(tr, bill);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    body.append(tr);
  }
  // Bill lines open in a modal popup; closing returns focus to the bill row.
  const billDialog = el("bill-dialog");
  let billOpener = null, billRequest = 0;
  billDialog.addEventListener("close", () => { billRequest++; billOpener?.focus(); });
  el("bill-dialog-close").addEventListener("click", () => billDialog.close());
  billDialog.addEventListener("click", (e) => {
    if (e.target !== billDialog) return; // clicks on the backdrop land on the <dialog> itself
    const r = billDialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) billDialog.close();
  });
  async function openBill(tr, bill) {
    billOpener = tr;
    const request = ++billRequest;
    const signed = bill.flag === 48 ? -bill.amount : Number(bill.amount);
    el("bill-dialog-kicker").replaceChildren(badge(bill.flag));
    el("bill-dialog-title").textContent = bill.docNo;
    el("bill-dialog-meta").textContent = `${day(bill.date)} · ${bill.saleCode ? teamLabel(bill.saleCode) : "ไม่ระบุพนักงานขาย"} · ${el("history-name").textContent} (${customer})`;
    const cell = el("bill-dialog-body");
    cell.replaceChildren(node("p", "กำลังโหลดรายการสินค้า…", "cs2-status"));
    if (!billDialog.open) billDialog.showModal();
    try {
      const { lines } = await getJSON(`/api/customer-stock/bill?${new URLSearchParams({ docNo: bill.docNo, date: bill.date, flag: bill.flag, customer })}`);
      if (request !== billRequest) return;
      if (!lines.length) { cell.replaceChildren(node("p", "ไม่พบรายการสินค้าในเอกสารนี้", "cs2-status")); return; }
      const table = node("table", "", "cs2-lines");
      const head = node("tr");
      ["รหัสสินค้า", "ชื่อสินค้า", "จำนวน", "ยอด"].forEach((h, i) => head.append(node("th", h, i >= 2 ? "num" : "")));
      table.append(node("thead"));
      table.tHead.append(head);
      const tbody = node("tbody");
      let total = 0;
      for (const line of lines) {
        total += Number(line.amount) || 0;
        const row = node("tr");
        row.append(node("td", line.code, "doc"), node("td", line.name), node("td", `${num(line.quantity)} ${line.unit || ""}`.trim(), "num"), node("td", baht(line.amount), "num"));
        tbody.append(row);
      }
      table.append(tbody);
      const scroll = node("div", "", "cs2-dialog-table");
      scroll.append(table);
      const totals = node("dl", "", "cs2-dialog-totals");
      const pair = (label, value, strong = false) => {
        const row = node("div", "", strong ? "strong" : "");
        row.append(node("dt", label), node("dd", value));
        totals.append(row);
      };
      pair(`ผลรวมรายการ (${num(lines.length)} บรรทัด)`, baht(bill.flag === 48 ? -total : total));
      pair("ยอดท้ายบิล", baht(signed), true);
      const parts = [scroll, totals];
      // Only explain a difference when there is one (discount / VAT on the document total).
      if (Math.abs(total - Number(bill.amount)) >= 0.005)
        parts.push(node("p", `ต่างกัน ${baht(Number(bill.amount) - total)} — ยอดท้ายบิลอาจรวมส่วนลดหรือ VAT จึงไม่เท่ากับผลรวมรายการ`, "cs2-status"));
      cell.replaceChildren(...parts);
    } catch (e) {
      if (request === billRequest) cell.replaceChildren(node("p", errorText(e), "cs2-status error"));
    }
  }
  let billPages = 1;
  const goBills = (page) => {
    billPage = Math.min(Math.max(0, page), billPages - 1);
    loadHistory();
    el("bills-title").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  el("bills-first").addEventListener("click", () => goBills(0));
  el("bills-prev").addEventListener("click", () => goBills(billPage - 1));
  el("bills-next").addEventListener("click", () => goBills(billPage + 1));
  el("bills-last").addEventListener("click", () => goBills(billPages - 1));

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
      stockSummary = { ...s, matching: data.matching };
      el("stock-value").textContent = baht(s.value);
      el("stock-in").textContent = `${num(s.inStock)} รายการ`;
      el("stock-total").textContent = `จากสินค้าในทะเบียน ${num(s.products)} รายการ`;
      el("stock-noprice").textContent = `${num(s.inStockNoPrice)} รายการ`;
      el("stock-quantity").textContent = num(s.quantity);
      const units = s.units || [];
      el("stock-units").textContent = units.length
        ? `รวมทุกหน่วย · ${units.slice(0, 3).map((u) => `${u.unit} ${num(u.quantity)}`).join(" · ")}${units.length > 3 ? ` · อื่น ๆ ${units.length - 3} หน่วย` : ""}`
        : "ไม่มีสินค้าคงเหลือ";
      el("stock-units").title = units.map((u) => `${u.unit} ${num(u.quantity)}`).join("\n");
      el("stock-problem").textContent = `${num(s.negative)} / ${num(s.noStockData)}`;
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
  // Stock cards open a popup with the full breakdown, and can jump the table to the matching items.
  let stockSummary = null, kpiOpener = null;
  const kpiDialog = el("kpi-dialog");
  kpiDialog.addEventListener("close", () => kpiOpener?.focus());
  el("kpi-dialog-close").addEventListener("click", () => kpiDialog.close());
  kpiDialog.addEventListener("click", (e) => {
    if (e.target !== kpiDialog) return;
    const r = kpiDialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) kpiDialog.close();
  });
  const showList = (filter, sort = "value") => {
    el("stock-filter").value = filter; el("stock-sort").value = sort; el("stock-search").value = "";
    kpiDialog.close(); restartStock();
    el("stock-filters").scrollIntoView({ block: "start", behavior: "smooth" });
  };
  function openKpi(card) {
    const s = stockSummary;
    if (!s) return;
    kpiOpener = card;
    const items = (n) => `${num(n)} รายการ`;
    const products = Number(s.products) || 0, inStock = Number(s.inStock) || 0, nodata = Number(s.noStockData) || 0, neg = Number(s.negative) || 0;
    const zero = Math.max(0, products - inStock - nodata - neg);
    const rows = (pairs) => {
      const dl = node("dl", "", "cs2-dialog-totals");
      for (const [label, value, strong, tone] of pairs) { const r = node("div", "", strong ? "strong" : ""); const dt = node("dt"); if (tone) dt.append(node("i", "", `dot ${tone}`)); dt.append(label); r.append(dt, node("dd", value)); dl.append(r); }
      return dl;
    };
    const button = (text, filter, sort, count = 1) => { if (!(Number(count) > 0)) return node("span"); const b = node("button", text, "cs2-more"); b.type = "button"; b.addEventListener("click", () => showList(filter, sort)); return b; };
    const body = [], kind = card.dataset.kpi;
    let title = "", meta = "";
    if (kind === "value") {
      title = `มูลค่าสต็อก ${baht(s.value)}`; meta = "ราคาขายในทะเบียน (price_0 หน่วยมาตรฐาน) × คงเหลือ";
      body.push(rows([["สินค้าที่คิดมูลค่า (มีของ + มีราคา)", items(inStock - (Number(s.inStockNoPrice) || 0)), false, "good"], ["มีของแต่ไม่มีราคาขาย (ไม่นับ)", items(s.inStockNoPrice), false, "warn"], ["คงเหลือติดลบ (ไม่นับ)", items(neg), false, "bad"], ["ไม่มีข้อมูลคงเหลือ (ไม่นับ)", items(nodata), false, "none"], ["มูลค่ารวม", baht(s.value), true]]),
        node("p", "ไม่รวมสินค้าฝาก (รหัสขึ้นต้น ฝ) · เป็นมูลค่าตามราคาขาย ไม่ใช่ต้นทุน · ใช้คงเหลือในทะเบียนปัจจุบัน", "cs2-status"), button("ดูสินค้าเรียงตามมูลค่าสูงสุด", "in", "value"));
    } else if (kind === "in") {
      title = `สินค้าที่มีของ ${items(inStock)}`; meta = `จากสินค้าในทะเบียน ${items(products)} (ไม่รวมสินค้าฝาก)`;
      body.push(rows([["มีของ (คงเหลือ > 0)", items(inStock), false, "good"], ["หมด (คงเหลือ = 0)", items(zero), false, "warn"], ["ติดลบ", items(neg), false, "bad"], ["ไม่มีข้อมูลคงเหลือ", items(nodata), false, "none"], ["รวมในทะเบียน", items(products), true]]),
        button("ดูสินค้าที่มีของ", "in", "quantity"));
    } else if (kind === "noprice") {
      title = `มีของแต่ไม่มีราคาขาย ${items(s.inStockNoPrice)}`; meta = "คงเหลือมากกว่า 0 แต่ไม่มีราคาขายที่เป็นตัวเลขในทะเบียน";
      body.push(node("p", "สินค้ากลุ่มนี้ไม่ถูกนับในมูลค่าสต็อก ถ้าตั้งราคาขายใน SML แล้ว มูลค่าจะเพิ่มขึ้นในการโหลดครั้งถัดไป", "cs2-status"), button("ดูรายการสินค้ากลุ่มนี้", "noprice", "quantity", s.inStockNoPrice));
    } else if (kind === "quantity") {
      title = `จำนวนคงเหลือรวม ${num(s.quantity)}`; meta = "รวมทุกหน่วย · เฉพาะสินค้าที่คงเหลือมากกว่า 0 · แยกตามหน่วยด้านล่าง";
      const table = node("table", "", "cs2-lines"), head = node("tr");
      ["หน่วย", "จำนวนคงเหลือ", "สัดส่วน"].forEach((h, i) => head.append(node("th", h, i ? "num" : "")));
      table.append(node("thead")); table.tHead.append(head);
      const tb = node("tbody"), total = Number(s.quantity) || 0;
      for (const u of s.units || []) { const r = node("tr"); r.append(node("td", u.unit || "ไม่ระบุหน่วย"), node("td", num(u.quantity), "num"), node("td", total ? `${num((u.quantity / total) * 100)}%` : "—", "num")); tb.append(r); }
      table.append(tb);
      const wrap = node("div", "", "cs2-dialog-table"); wrap.append(table);
      body.push(wrap, node("p", "หน่วยต่างกันจึงไม่ควรเทียบตัวเลขรวมตรง ๆ ระหว่างสินค้าคนละชนิด", "cs2-status"), button("ดูสินค้าเรียงตามคงเหลือมากสุด", "in", "quantity"));
    } else if (kind === "problem") {
      title = `ติดลบ ${num(neg)} / ไม่มีข้อมูล ${num(nodata)}`; meta = "ไม่นับในมูลค่าสต็อก";
      body.push(rows([["คงเหลือติดลบ", items(neg), false, "bad"], ["ไม่มีข้อมูลคงเหลือ (ไม่ใช่ 0)", items(nodata), false, "none"]]),
        node("p", neg + nodata ? "ติดลบมักเกิดจากตัดขายก่อนรับเข้า ส่วนไม่มีข้อมูลคือทะเบียนไม่มีค่าคงเหลือ ระบบไม่ถือว่าเป็น 0" : "ตอนนี้ไม่มีสินค้าคงเหลือติดลบ และไม่มีสินค้าที่ไม่มีข้อมูลคงเหลือ ✓", "cs2-status"));
      const actions = node("div", "", "cs2-dialog-actions");
      actions.append(button("ดูรายการติดลบ", "negative", "quantity", neg), button("ดูรายการไม่มีข้อมูล", "nodata", "code", nodata));
      body.push(actions);
    }
    el("kpi-dialog-title").textContent = title;
    el("kpi-dialog-meta").textContent = meta;
    el("kpi-dialog-body").replaceChildren(...body);
    kpiDialog.showModal();
  }
  document.querySelectorAll(".cs2-kpi-click").forEach((card) => {
    card.addEventListener("click", () => openKpi(card));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openKpi(card); } });
  });
  el("stock-search").addEventListener("input", () => { clearTimeout(stockTimer); stockTimer = setTimeout(restartStock, 300); });
  el("stock-filter").addEventListener("change", restartStock);
  el("stock-sort").addEventListener("change", restartStock);
  el("stock-filters").addEventListener("submit", (e) => { e.preventDefault(); restartStock(); });
  el("stock-prev").addEventListener("click", () => { stockPage = Math.max(0, stockPage - 1); loadStock(); });
  el("stock-next").addEventListener("click", () => { stockPage += 1; loadStock(); });

  // ---------- Tab 3: product movement ----------
  let movement = null, movementController, cyclesShown = 0, movesShown = 0;
  // Product filters (same definitions as เช็คราคา/สต๊อก) → list on the left → movement on the right.
  let productGroups = null, productController, productTimer, productOffset = 0, productTotal = 0, currentProduct = null;
  let allSubgroups = [];
  async function loadProductGroups() {
    try {
      const data = await getJSON("/api/customer-stock/product-groups");
      allSubgroups = data.subgroups;
      const group = el("product-group");
      for (const g of data.groups) group.append(new Option(`${g.name}${g.name !== g.code ? ` · ${g.code}` : ""} (${num(g.count)})`, g.code));
      group.disabled = false;
      fillSubgroups();
    } catch (e) {
      status("product-search-status", `โหลดกลุ่มสินค้าไม่สำเร็จ · ${errorText(e)}`, true);
    }
  }
  function fillSubgroups() {
    const select = el("product-subgroup"), group = el("product-group").value;
    const list = allSubgroups.filter((s) => !group || s.main === group);
    select.replaceChildren(new Option("ทุกกลุ่มสินค้าย่อย", ""));
    for (const s of list) select.append(new Option(`${s.name}${s.name !== s.code ? ` · ${s.code}` : ""} (${num(s.count)})`, s.code));
    select.disabled = !list.length;
  }
  // 10 products per page (server pageSize); keepPage=false (a filter changed) goes back to page 1.
  async function loadProducts(keepPage = false) {
    productController?.abort();
    productController = new AbortController();
    if (!keepPage) productOffset = 0;
    const list = el("product-list");
    list.replaceChildren();
    el("product-list-title").textContent = "กำลังโหลดสินค้า…";
    status("product-search-status", "");
    el("product-prev").disabled = el("product-next").disabled = true;
    try {
      const params = { q: el("product-search").value.trim(), group: el("product-group").value, subgroup: el("product-subgroup").value, stock: el("product-stock").value, offset: productOffset };
      const data = await getJSON(`/api/customer-stock/product-list?${new URLSearchParams(params)}`, productController.signal);
      productTotal = data.total;
      el("product-list-title").textContent = `สินค้าตามตัวกรอง · ${num(data.total)} รายการ`;
      if (!data.total) list.append(node("li", "ไม่พบสินค้าตามตัวกรอง", "cs2-status"));
      for (const p of data.rows) {
        const li = node("li"), button = node("button");
        button.type = "button";
        button.dataset.code = p.code;
        const stock = p.quantity == null ? "ไม่มีข้อมูลคงเหลือ" : `คงเหลือ ${num(p.quantity)} ${p.unit || ""}`.trim();
        button.append(node("span", p.name), node("small", `${p.code} · ${stock}`));
        button.addEventListener("click", () => loadMovement(p.code));
        li.append(button);
        list.append(li);
      }
      productPageSize = data.pageSize;
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize)), page = Math.floor(productOffset / data.pageSize) + 1;
      el("product-page").textContent = `หน้า ${num(page)} / ${num(pages)}`;
      el("product-prev").disabled = page <= 1;
      el("product-next").disabled = page >= pages;
      markProduct();
    } catch (e) {
      if (e.name === "AbortError") return;
      el("product-list-title").textContent = "โหลดรายการสินค้าไม่สำเร็จ";
      status("product-search-status", errorText(e), true);
    }
  }
  function markProduct() {
    el("product-list").querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.code === currentProduct)));
  }
  el("product-search").addEventListener("input", () => { clearTimeout(productTimer); productTimer = setTimeout(() => loadProducts(), 300); });
  el("product-group").addEventListener("change", () => { fillSubgroups(); loadProducts(); });
  el("product-subgroup").addEventListener("change", () => loadProducts());
  el("product-stock").addEventListener("change", () => loadProducts());
  el("product-filters").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(productTimer); loadProducts(); });
  let productPageSize = 5;
  el("product-prev").addEventListener("click", () => { productOffset = Math.max(0, productOffset - productPageSize); loadProducts(true); });
  el("product-next").addEventListener("click", () => { productOffset += productPageSize; loadProducts(true); });
  function startMovementTab() {
    if (productGroups) return;
    productGroups = true;
    loadProductGroups();
    loadProducts();
  }
  // Below 1280px (iPad, phones) the product journey opens as a modal popup; wider screens keep it inline.
  const narrow = window.matchMedia("(max-width: 1280px)");
  const sheet = el("movement-dialog");
  let sheetOpener = null;
  function showMovementSheet() {
    sheetOpener = document.activeElement;
    if (narrow.matches) {
      if (!sheet.matches(":modal")) { if (sheet.open) sheet.close(); sheet.showModal(); }
      sheet.scrollTop = 0;
    } else if (!sheet.open) sheet.show();
  }
  el("movement-close").addEventListener("click", () => sheet.close());
  sheet.addEventListener("close", () => { if (narrow.matches) sheetOpener?.focus?.(); });
  sheet.addEventListener("click", (e) => {
    if (e.target !== sheet || !sheet.matches(":modal")) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
  });
  // Rotating / resizing across 1280px switches between popup and inline without losing the product.
  narrow.addEventListener("change", () => {
    if (!sheet.open || el("movement-view").hidden) return;
    sheet.close();
    if (narrow.matches) el("movement-empty").hidden = false; else showMovementSheet();
  });
  async function loadMovement(code) {
    currentProduct = code;
    markProduct();
    movementController?.abort();
    movementController = new AbortController();
    el("movement-empty").hidden = !narrow.matches; // popup mode keeps the hint under the list
    el("movement-view").hidden = false;
    showMovementSheet();
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

  // ⓘ explanations on every card (hover / focus / tap). Text only — the numbers come from the API.
  const HELP = {
    "history-net": "ยอดท้ายบิลของลูกค้ารายนี้ทุกช่วงเวลา: บิลขาย + เพิ่มหนี้ − รับคืน/ลดหนี้ ไม่นับเอกสารยกเลิกและสำเนา",
    "history-invoices": "จำนวนบิลขาย (เอกสารขาย) ที่ไม่ยกเลิก ไม่นับเพิ่มหนี้และรับคืน ตัวเลขด้านล่างคือเอกสารทุกประเภทรวมกัน",
    "history-avg": "ยอดขาย ÷ จำนวนบิลขาย ใช้ยอดก่อนหักรับคืน",
    "history-first": "วันที่ของบิลขายใบแรกที่พบใน SML และระยะเวลาที่เป็นลูกค้าจนถึงวันนี้",
    "history-last": "วันที่ของบิลขายใบล่าสุด และผ่านมากี่วันแล้ว",
    "trend-title": "ยอดสุทธิ (ขาย + เพิ่มหนี้ − รับคืน) ของแต่ละเดือนย้อนหลัง 24 เดือน แท่งเทาคือเดือนที่ไม่มีเอกสาร ชี้ที่แท่งเพื่อดูยอดและจำนวนบิล",
    "stock-value": "ราคาขายในทะเบียน × คงเหลือ นับเฉพาะสินค้าที่คงเหลือมากกว่า 0 และมีราคาขาย ไม่รวมสินค้าฝาก (ฝ) เป็นมูลค่าตามราคาขาย ไม่ใช่ต้นทุน กดการ์ดเพื่อดูรายละเอียด",
    "stock-in": "จำนวนรหัสสินค้าที่คงเหลือในทะเบียนมากกว่า 0 จากสินค้าทั้งหมดในทะเบียน (ไม่รวมสินค้าฝาก) กดการ์ดเพื่อดูการแบ่งกลุ่ม",
    "stock-noprice": "สินค้าที่มีคงเหลือแต่ไม่มีราคาขายที่เป็นตัวเลขในทะเบียน จึงไม่ถูกนับในมูลค่าสต็อก กดการ์ดเพื่อดูรายการ",
    "stock-quantity": "คงเหลือของสินค้าทุกตัวรวมกัน (เฉพาะที่มากกว่า 0) เป็นการบวกข้ามหน่วย เช่น ตัว + ใบ + ชุด กดการ์ดเพื่อดูยอดแยกทุกหน่วย",
    "stock-problem": "ซ้าย: สินค้าที่คงเหลือติดลบ · ขวา: สินค้าที่ไม่มีข้อมูลคงเหลือ (ไม่ใช่ 0) ทั้งสองกลุ่มไม่นับในมูลค่า",
    "movement-balance": "คงเหลือในทะเบียนสินค้าปัจจุบัน และเทียบกับยอดที่คำนวณจากความเคลื่อนไหวทั้งหมด ถ้าไม่ตรงจะแจ้งเตือน",
    "movement-cycles": "จำนวนครั้งที่คงเหลือขึ้นจาก 0 (หรือติดลบ) เป็นมากกว่า 0 แต่ละรอบเริ่มที่ของเข้า และจบเมื่อขายหมด",
    "movement-avg": "จำนวนวันเฉลี่ยตั้งแต่ของเข้าจนคงเหลือกลับเป็น 0 นับเฉพาะรอบที่หมดแล้ว",
    "movement-count": "จำนวนรายการรับเข้า/เบิกออกทั้งหมดของสินค้านี้ ตามเงื่อนไขรายงาน 2060 (เคลื่อนไหวสินค้าตามคลัง)",
    "journey-title": "① วันเข้า = วันที่คงเหลือขึ้นจาก 0 · ② ใครซื้อ = ลูกค้าที่มีบิลขายในรอบนั้น · ③ วันหมด = วันที่คงเหลือกลับเป็น 0 หรือยังไม่หมด",
  };
  for (const [id, text] of Object.entries(HELP)) {
    const target = el(id);
    if (!target) continue;
    const host = target.closest(".cs2-kpi") || target;
    const label = host.matches(".cs2-kpi") ? host.querySelector("span").textContent : target.textContent;
    const wrap = node("span", "", "cs2-help");
    const btn = node("button", "ⓘ", "cs2-help-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", `คำอธิบาย ${label}`);
    const tip = node("span", text, "cs2-help-tip");
    tip.setAttribute("role", "tooltip");
    tip.id = `help-${id}`;
    btn.setAttribute("aria-describedby", tip.id);
    // Keep the card's own popup closed; a tap toggles the tip on touch screens.
    btn.addEventListener("click", (e) => { e.stopPropagation(); wrap.classList.toggle("open"); });
    btn.addEventListener("keydown", (e) => e.stopPropagation());
    btn.addEventListener("blur", () => wrap.classList.remove("open"));
    wrap.append(btn, tip);
    if (host.matches(".cs2-kpi")) host.append(wrap); else target.append(wrap);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".cs2-help.open").forEach((w) => w.classList.remove("open")); });

  showTab(location.hash.slice(1));
})();
