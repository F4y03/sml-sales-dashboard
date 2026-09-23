const element = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const money = (value) =>
  value == null ? "ข้อมูลไม่ครบ" : "฿" + number.format(value);
const percent = (value) =>
  value == null
    ? "ไม่มีฐานเทียบ"
    : `${value > 0 ? "↑ +" : value < 0 ? "↓ " : ""}${number.format(value)}%`;
const margin = (profit, revenue) =>
  profit != null && revenue > 0 ? (profit / revenue) * 100 : null;
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
let current = null,
  activeTeam = "staff",
  controller,
  requestId = 0;
const today = new Date();
element("end").value = iso(today);
element("start").value = iso(
  new Date(today.getFullYear(), today.getMonth(), 1),
);
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const compactMoney = (value) => {
  const abs = Math.abs(value);
  return "฿" + (abs >= 1e6 ? number.format(Math.round(value / 1e4) / 100) + "M" : abs >= 1e3 ? number.format(Math.round(value / 100) / 10) + "K" : number.format(value));
};
// Monday–Saturday; Sunday is the closed day.
function workingDays(from, to) {
  let count = 0;
  for (let day = new Date(from + "T00:00:00"), last = new Date(to + "T00:00:00"); day <= last; day.setDate(day.getDate() + 1))
    if (day.getDay() !== 0) count++;
  return count;
}
// Main numbers count up from 0 in 1 s on a fresh load (not on the silent 60 s refresh).
function countUp(target, to, format, animate) {
  const token = (target.countToken = (target.countToken || 0) + 1),
    paint = (value) => target.replaceChildren(...[format(value)].flat());
  if (!animate || prefersReducedMotion() || !Number.isFinite(to)) return paint(to);
  const began = performance.now(),
    tick = (now) => {
      if (target.countToken !== token) return;
      const k = Math.min(1, (now - began) / 1000);
      paint(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
  paint(0);
  requestAnimationFrame(tick);
}
// Target period: a calendar month when the range sits inside one month, otherwise the exact range.
function targetPeriod() {
  const start = element("start").value,
    end = element("end").value;
  if (start.slice(0, 7) === end.slice(0, 7)) {
    const [year, month] = start.split("-").map(Number);
    return { key: `month:${start.slice(0, 7)}`, label: `เดือน ${THAI_MONTHS[month - 1]} ${year + 543}`, first: start.slice(0, 8) + "01", last: iso(new Date(year, month, 0)) };
  }
  return { key: `range:${start}:${end}`, label: `ช่วง ${start} – ${end}`, first: start, last: end };
}
let salesTarget = { key: null, amount: null, loading: false, saving: false, editing: false, error: "" };
async function putTarget(key, amount) {
  const response = await fetch("/api/executive/target", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
    body: JSON.stringify({ key, amount }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "บันทึกเป้าไม่สำเร็จ");
  return data;
}
async function loadTarget() {
  const { key } = targetPeriod();
  salesTarget = { key, amount: null, loading: true, saving: false, editing: false, error: "" };
  renderTarget();
  try {
    const response = await fetch("/api/executive/target?" + new URLSearchParams({ key }), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "โหลดเป้าไม่สำเร็จ");
    if (salesTarget.key !== key) return;
    let amount = data.amount;
    // One-time move of a target the previous version kept only in this browser.
    const legacyKey = `executive-target:${element("start").value}:${element("end").value}`;
    let legacy = null;
    try {
      legacy = Number(localStorage.getItem(legacyKey));
    } catch {}
    if (amount == null && legacy > 0) {
      amount = (await putTarget(key, legacy).catch(() => ({ amount: null }))).amount;
      if (amount != null)
        try {
          localStorage.removeItem(legacyKey);
        } catch {}
    }
    salesTarget = { ...salesTarget, amount, loading: false };
  } catch (error) {
    if (salesTarget.key !== key) return;
    salesTarget = { ...salesTarget, loading: false, error: error.message };
  }
  renderTarget(true);
}
function formatTarget(input) {
  const position = input.selectionStart ?? input.value.length;
  const offset = input.value.slice(0, position).replaceAll(",", "").length;
  const raw = input.value.replaceAll(",", "");
  const valid = /^\d+(\.\d{0,2})?$/.test(raw);
  input.setCustomValidity(
    raw && (!valid || !Number.isFinite(Number(raw)) || Number(raw) <= 0)
      ? "กรอกเป้ามากกว่า 0 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง"
      : "",
  );
  if (!valid) return;
  const [whole, fraction] = raw.split(".");
  input.value =
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction === undefined ? "" : "." + fraction);
  let cursor = 0,
    consumed = 0;
  while (cursor < input.value.length && consumed < offset) {
    if (input.value[cursor] !== ",") consumed++;
    cursor++;
  }
  if (document.activeElement === input) input.setSelectionRange(cursor, cursor);
}
function node(tag, text, className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
}
function targetValue() {
  return salesTarget.amount > 0 ? salesTarget.amount : null;
}
function growBar(bar, width, animate) {
  if (!animate || prefersReducedMotion()) {
    bar.style.width = width + "%";
    return;
  }
  bar.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = width + "%")));
}
function targetForm(target, period) {
  const form = node("form", "", "kpi-target-form"),
    input = document.createElement("input"),
    save = node("button", salesTarget.saving ? "กำลังบันทึก…" : "ตั้งเป้า", "kpi-target-save");
  input.id = "target";
  input.type = "text";
  input.inputMode = "decimal";
  input.placeholder = "เช่น 10,000,000";
  input.autocomplete = "off";
  input.setAttribute("aria-label", `เป้ายอดขายสุทธิ${period.label} (บาท)`);
  input.value = target ? String(target) : "";
  formatTarget(input);
  input.addEventListener("input", () => formatTarget(input));
  save.type = "submit";
  save.disabled = salesTarget.saving;
  const row = node("div", "", "kpi-target-row");
  row.append(input, save);
  form.append(row);
  if (target) {
    const actions = node("div", "", "kpi-target-actions"),
      cancel = node("button", "ยกเลิก", "kpi-text-button"),
      remove = node("button", "ลบเป้า", "kpi-text-button danger");
    cancel.type = remove.type = "button";
    cancel.addEventListener("click", () => {
      salesTarget = { ...salesTarget, editing: false, error: "" };
      renderTarget();
    });
    remove.addEventListener("click", () => submitTarget(null));
    actions.append(cancel, remove);
    form.append(actions);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = input.value.replaceAll(",", "");
    if (!raw || !input.validity.valid) {
      input.setCustomValidity(input.validationMessage || "กรอกเป้ามากกว่า 0 บาท");
      input.reportValidity();
      return;
    }
    submitTarget(Number(raw));
  });
  return form;
}
async function submitTarget(amount) {
  const { key } = salesTarget;
  salesTarget = { ...salesTarget, saving: true, error: "" };
  renderTarget();
  try {
    const saved = await putTarget(key, amount);
    if (salesTarget.key !== key) return;
    salesTarget = { ...salesTarget, amount: saved.amount, saving: false, editing: false };
    renderTarget(true);
  } catch (error) {
    if (salesTarget.key !== key) return;
    salesTarget = { ...salesTarget, saving: false, error: error.message };
    renderTarget();
  }
}
function renderTarget(animate = false) {
  const body = element("target-body");
  body.replaceChildren();
  body.style.minHeight = salesTarget.editing && salesTarget.lockHeight ? salesTarget.lockHeight + "px" : "";
  if (!current || salesTarget.loading) {
    body.append(node("p", "กำลังโหลดเป้า…", "kpi-muted"));
    return;
  }
  const period = targetPeriod(),
    target = targetValue();
  if (!target || salesTarget.editing) {
    if (!target) {
      const empty = node("strong", "ยังไม่ตั้งเป้า", "kpi-empty");
      empty.id = "achievement";
      body.append(empty, node("small", `ตั้งเป้ายอดขายสุทธิของ${period.label}`, "kpi-caption"));
    } else body.append(node("small", `แก้ไขเป้าของ${period.label}`, "kpi-caption"));
    body.append(targetForm(target, period));
  } else {
    const share = (current.net / target) * 100,
      reached = current.net >= target,
      value = node("strong", "", "kpi-value");
    value.id = "achievement";
    countUp(value, share, (v) => number.format(Math.round(v * 100) / 100) + "%", animate);
    const progress = node("div", "", "kpi-progress"),
      fill = node("span", "");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "ความคืบหน้าเป้ายอดขาย");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(Math.round(Math.max(0, Math.min(100, share)))));
    progress.append(fill);
    growBar(fill, Math.max(0, Math.min(100, share)), animate);
    const today = iso(new Date()),
      daysLeft = today > period.last ? 0 : workingDays(today < period.first ? period.first : today, period.last),
      gap = target - current.net,
      legend = node("div", "", "kpi-split-legend");
    // Whole baht keeps the line from wrapping (which would make the whole card row taller); exact value on hover.
    const baht = (value) => "฿" + Math.round(value).toLocaleString("th-TH"),
      exact = node("span", reached ? `เกินเป้า ${baht(current.net - target)}` : `ขาดอีก ${baht(gap)}`);
    exact.title = money(Math.abs(gap));
    if (reached) legend.append(node("span", "ถึงเป้าแล้ว", "up"), exact);
    else legend.append(exact, node("span", daysLeft ? `~${compactMoney(gap / daysLeft)} / วันทำการ` : "ช่วงนี้สิ้นสุดแล้ว"));
    const edit = node("button", "แก้ไขเป้า", "kpi-text-button");
    edit.type = "button";
    edit.addEventListener("click", () => {
      // Keep the card as tall as the progress view so the whole card row doesn't change size while editing.
      salesTarget = { ...salesTarget, editing: true, lockHeight: element("target-body").offsetHeight };
      renderTarget();
      element("target")?.focus();
    });
    body.append(value, node("small", `ของเป้า ${compactMoney(target)} · ${period.label}`, "kpi-caption"), progress, legend, edit);
  }
  if (salesTarget.error) {
    const message = node("p", salesTarget.error, "kpi-error");
    message.setAttribute("role", "alert");
    body.append(message);
  }
}
// Sparkline: cumulative daily sales of the selected range (sales documents before returns).
let sparkRequest = 0;
async function loadSpark() {
  const svg = element("growth-spark"),
    start = element("start").value,
    end = element("end").value,
    today = iso(new Date()),
    last = end < today ? end : today,
    request = ++sparkRequest;
  svg.replaceChildren();
  if (last < start || (Date.parse(last) - Date.parse(start)) / 86400000 > 62) {
    svg.setAttribute("aria-label", "กราฟยอดขายสะสมแสดงได้เมื่อช่วงไม่เกิน 62 วัน");
    return;
  }
  try {
    const response = await fetch("/api/sales-trend/daily?" + new URLSearchParams({ start, end: last }), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || request !== sparkRequest) return;
    let running = 0;
    const points = data.daily.map((day) => (running += Number(day.sales) || 0)),
      peak = Math.max(...points, 1),
      x = (i) => (points.length > 1 ? (i / (points.length - 1)) * 240 : 120),
      y = (v) => 40 - (v / peak) * 36,
      line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""),
      ns = "http://www.w3.org/2000/svg",
      make = (tag, attrs) => {
        const item = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) item.setAttribute(k, v);
        svg.append(item);
        return item;
      };
    const defs = make("defs", {}),
      grad = document.createElementNS(ns, "linearGradient");
    grad.id = "spark-fill";
    for (const [k, v] of Object.entries({ x1: 0, y1: 0, x2: 0, y2: 1 })) grad.setAttribute(k, v);
    grad.innerHTML = '<stop offset="0%" stop-color="currentColor" stop-opacity="0.35"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/>';
    defs.append(grad);
    make("path", { d: `${line}L${x(points.length - 1).toFixed(1)},44L${x(0).toFixed(1)},44Z`, fill: "url(#spark-fill)", class: "spark-area" });
    make("path", { d: line, class: "spark-line", "vector-effect": "non-scaling-stroke" });
    svg.setAttribute("aria-label", `ยอดขายสะสมรายวัน ก่อนหักคืน ถึง ${last}: ${money(points.at(-1) || 0)}`);
  } catch {
    if (request === sparkRequest) svg.setAttribute("aria-label", "โหลดกราฟยอดขายสะสมไม่สำเร็จ");
  }
}
function teamRegion(item) {
  const code = String(item.code || "")
    .trim()
    .replace(/^ฝ/, "")
    .replace(/^กท-/, "ก");
  const regions = {
    กจ: "ภาคกลาง",
    กณ: "ภาคกลาง",
    กต: "ภาคกลาง",
    กร: "ภาคกลาง",
    กภ: "ภาคกลาง",
    บอ: "ภาคกลาง",
    หย: "ภาคเหนือ",
    ตช: "ภาคใต้",
    ลภ: "ภาคตะวันออก",
    อย: "ภาคตะวันออกเฉียงเหนือ",
  };
  // Explicit region assignments take precedence over the SML area name.
  return regions[code] || item.area || "";
}
function renderTeam() {
  element("branches-tab").setAttribute(
    "aria-pressed",
    String(activeTeam === "branches"),
  );
  element("staff-tab").setAttribute(
    "aria-pressed",
    String(activeTeam === "staff"),
  );
  const container = element("leaders");
  container.replaceChildren();
  current[activeTeam].forEach((item, index) => {
    const row = node("button", "", "leader team-detail-button");
    row.type = "button";
    row.setAttribute("aria-haspopup", "dialog");
    row.setAttribute("aria-controls", "detail");
    row.setAttribute(
      "aria-label",
      `ดูรายละเอียด ${item.name} รหัส ${item.code || "ไม่ระบุ"}`,
    );
    row.addEventListener("click", () =>
      openTeamDetail(item, index, activeTeam),
    );
    const identity = node("div", "", "team-identity");
    identity.append(node("span", item.name, "team-name"));
    if (activeTeam === "staff") {
      const meta = node("div", "", "team-meta");
      const region = teamRegion(item);
      meta.append(
        node(
          "span",
          region ? `เขตการขาย: ${region}` : "ยังไม่ระบุเขตการขาย",
          "team-area",
        ),
      );
      meta.append(node("span", `รหัส: ${item.code || "—"}`, "team-code"));
      identity.append(meta);
    }
    row.append(
      node("span", index + 1, "rank"),
      identity,
      node("strong", money(item.sales)),
    );
    container.append(row);
  });
  if (!current[activeTeam].length)
    container.append(node("p", "ไม่พบรายการในช่วงวันที่เลือก", "note"));
}
function openTeamDetail(item, index, team) {
  if (!current) return;
  element("detail-title").textContent =
    `รายละเอียด${team === "staff" ? "พนักงานขาย" : "สาขา"} · ${item.name}`;
  const body = element("detail-body");
  body.replaceChildren();
  const date = (value) =>
    new Date(value + "T00:00:00").toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const layout = node("div", "", "team-profile");
  const heading = node("div", "", "team-profile-heading");
  const avatar = node(
    "span",
    (item.name || "—").trim().slice(0, 1),
    "team-profile-avatar",
  );
  avatar.setAttribute("aria-hidden", "true");
  const identity = node("div", "", "team-profile-identity");
  identity.append(
    node("h3", item.name),
    node("p", "รหัสพนักงาน/สาขา " + (item.code || "ไม่ระบุ")),
  );
  heading.append(avatar, identity);
  if (team === "staff")
    heading.append(
      node("span", teamRegion(item) || "ยังไม่ระบุเขต", "team-profile-region"),
    );
  layout.append(
    heading,
    node(
      "p",
      date(current.start) + " – " + date(current.end),
      "team-profile-period",
    ),
  );
  const metrics = node("div", "", "team-profile-metrics");
  const sales = node("section", "", "team-profile-sales");
  sales.append(
    node("span", "ยอดรายการขายสุทธิ"),
    node("strong", money(item.sales)),
    node("small", "ขาย + เพิ่มหนี้ − รับคืน/ลดหนี้"),
  );
  const rank = node("section", "", "team-profile-rank");
  rank.append(
    node("span", "อันดับยอดขาย"),
    node("strong", "#" + (index + 1)),
    node("small", "ในช่วงวันที่เลือก"),
  );
  metrics.append(sales, rank);
  layout.append(metrics);
  const explanation = node("div", "", "team-profile-explanation");
  for (const [title, text] of [
    [
      "ยอดนี้คำนวณอย่างไร",
      "รวมยอดเงินจากรายการสินค้าในเอกสารขายและเพิ่มหนี้ แล้วหักรับคืน/ลดหนี้ เฉพาะช่วงวันที่เลือก โดยไม่นับเอกสารยกเลิกและสำเนา ยอดอาจต่างจากยอดรวมหน้าเอกสาร",
    ],
    [
      "ทำไมชื่อเดียวกันมีหลายแถว",
      team === "staff"
        ? "แยกอันดับตามรหัสพนักงานขาย ชื่อเดียวกันแต่คนละรหัสจึงแสดงแยกกัน เขตการขายใช้บอกพื้นที่ของรหัสนั้น ไม่ใช่ยอดรวมทั้งภาค"
        : "แยกอันดับตามรหัสสาขา ชื่อเดียวกันแต่คนละรหัสจึงแสดงแยกกัน",
    ],
  ]) {
    const section = node("section", "");
    section.append(node("h3", title), node("p", text));
    explanation.append(section);
  }
  layout.append(explanation);
  if (team === "staff")
    layout.append(
      node(
        "p",
        "เขตการขายอ้างอิงการจับคู่รหัสที่กำหนดไว้ หรือทะเบียน SML หากยังไม่ได้กำหนด",
        "team-profile-source",
      ),
    );
  layout.append(
    node(
      "p",
      "อัปเดตล่าสุด " + new Date(current.updatedAt).toLocaleString("th-TH"),
      "team-profile-updated",
    ),
  );
  body.append(layout);
  if (team === "staff") {
    const customers = node("section", "", "team-customer-list");
    customers.append(node("h3", "ลูกค้าของพนักงานในช่วงที่เลือก"));
    const status = node("p", "กำลังโหลดรหัสลูกค้าเต็ม…", "note");
    status.setAttribute("role", "status");
    customers.append(status);
    layout.insertBefore(customers, explanation);
    const params = new URLSearchParams({
      start: current.start,
      end: current.end,
      code: item.code || "",
    });
    const load = async () => {
      status.textContent = "กำลังโหลดรหัสลูกค้าเต็ม…";
      try {
        const response = await fetch("/api/executive/customers?" + params, {
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!customers.isConnected) return;
        status.textContent = `พบ ${data.rows.length} รายการ · ยอดรายการขายสุทธิของพนักงานคนนี้`;
        const scroll = node("div", "", "team-customer-scroll"),
          table = node("table", ""),
          head = node("thead", ""),
          row = node("tr", "");
        for (const label of ["รหัสลูกค้าเต็ม", "ชื่อลูกค้า", "ยอดขายสุทธิ"])
          row.append(node("th", label));
        head.append(row);
        table.append(head);
        const tbody = node("tbody", "");
        for (const customer of data.rows) {
          const tr = node("tr", "");
          tr.append(
            node("td", customer.code || "ไม่ระบุรหัส"),
            node("td", customer.name || "ไม่พบชื่อในทะเบียน"),
            node("td", money(customer.sales)),
          );
          tbody.append(tr);
        }
        table.append(tbody);
        scroll.append(table);
        customers.append(scroll);
      } catch {
        if (!customers.isConnected) return;
        status.textContent = "โหลดรายการลูกค้าไม่สำเร็จ ";
        const retry = node("button", "ลองใหม่");
        retry.type = "button";
        retry.onclick = load;
        status.append(retry);
      }
    };
    load();
  }
  element("detail").showModal();
}
function render(animate = false) {
  // Card 1: net sales, satang smaller and dimmer; split bar = kept (white) vs returned (pink) out of sales.
  const moneyParts = (value) => {
    const [whole, decimals] = Math.abs(value)
      .toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .split(".");
    return [`${value < 0 ? "−" : ""}฿${whole}`, node("span", "." + decimals, "kpi-decimals")];
  };
  countUp(element("net"), current.net, moneyParts, animate);
  const sales = Number(current.sales) || 0,
    returns = Number(current.returns) || 0,
    returnShare = sales > 0 ? (returns / sales) * 100 : 0;
  const [kept, returned] = element("net-split").children;
  growBar(kept, sales > 0 ? Math.max(0, Math.min(100, 100 - returnShare)) : 0, animate);
  growBar(returned, sales > 0 ? Math.max(0, Math.min(100, returnShare)) : 0, animate);
  element("net-sold").textContent = `ขาย ${money(sales)}`;
  element("net-returned").textContent = `คืน ${money(returns)} (${number.format(Math.round(returnShare * 10) / 10)}%)`;
  // Card 2: bills, average per bill (before returns) and bills per working day so far.
  const bills = current.salesInvoiceCount;
  if (bills == null) element("sales-invoice-count").textContent = "—";
  else countUp(element("sales-invoice-count"), bills, (v) => [number.format(Math.round(v)), " ", node("small", "บิล", "kpi-unit")], animate);
  element("average-sale").textContent = current.averageSale == null ? "ยังไม่มีบิลขาย" : money(Math.round(current.averageSale * 100) / 100);
  const today = iso(new Date()),
    lastDay = current.end < today ? current.end : today,
    days = lastDay < current.start ? 0 : workingDays(current.start, lastDay);
  element("bills-per-day").textContent = bills == null || !days ? "—" : number.format(Math.round((bills / days) * 10) / 10);
  element("bills-per-day").title = days ? `${number.format(bills ?? 0)} บิล ÷ ${days} วันทำการ (จ.–ส.)` : "";
  // Card 3: MoM with arrow, cumulative sparkline, YoY line.
  const signed = (v) => `${v >= 0 ? "↑ +" : "↓ −"}${number.format(Math.round(Math.abs(v) * 100) / 100)}%`,
    mom = element("mom");
  mom.classList.remove("up", "down");
  if (current.mom == null) {
    mom.textContent = "—";
    element("mom-caption").textContent = "ไม่มียอดเดือนก่อนให้เทียบ (MoM)";
  } else {
    mom.classList.add(current.mom >= 0 ? "up" : "down");
    countUp(mom, current.mom, signed, animate);
    element("mom-caption").textContent = "เทียบเดือนก่อน (MoM)";
  }
  const yoy = element("yoy");
  yoy.className = "kpi-yoy" + (current.yoy == null ? "" : current.yoy >= 0 ? " up" : " down");
  yoy.textContent = current.yoy == null ? "YoY — ไม่มียอดปีก่อนให้เทียบ" : `YoY ${signed(current.yoy)} เทียบปีก่อน`;
  renderTarget(animate);
  const body = element("products");
  body.replaceChildren();
  current.products.forEach((product, index) => {
    const row = node("tr", ""),
      name = node("td", `${index + 1}. ${product.name || product.code}`);
    name.append(node("small", product.code));
    const rate = margin(product.profit, product.revenue);
    const profit = node(
      "td",
      money(product.profit),
      rate != null && rate < 10 ? "warning" : "",
    );
    profit.append(
      node(
        "small",
        rate == null
          ? "ต้นทุน/ฐานรายได้ไม่ครบ"
          : `${number.format(rate)}%${rate < 10 ? " · กำไรต่ำ" : ""}`,
      ),
    );
    row.append(name, node("td", money(product.sales)), profit);
    body.append(row);
  });
  if (!current.products.length) {
    const row = node("tr", ""),
      cell = node("td", "ไม่พบรายการสินค้าในช่วงวันที่เลือก");
    cell.colSpan = 3;
    row.append(cell);
    body.append(row);
  }
  renderTeam();
  const alerts = [];
  current.declines.forEach((branch) =>
    alerts.push({
      category: "ยอดขายลดลง",
      icon: "↘",
      title: branch.name,
      description: "เทียบเดือนก่อน · ตรวจสอบทีมขายและลูกค้าหลัก",
      value: `−${number.format((1 - branch.sales / branch.previous) * 100)}%`,
      caption: "ยอดรายการขาย",
      detail: "growth",
    }),
  );
  current.products
    .filter(
      (product) =>
        product.stock != null && product.stock <= 5 && product.sales > 0,
    )
    .forEach((product) =>
      alerts.push({
        category: "สต๊อกใกล้หมด",
        icon: "▦",
        title: product.name || product.code,
        description: "สินค้าขายดี · ตรวจสอบสต๊อกจริงก่อนเติมสินค้า",
        value: `${number.format(product.stock)} ${product.unit || "หน่วยมาตรฐาน"}`,
        caption: "คงเหลือในทะเบียน",
        yellow: true,
        product,
      }),
    );
  current.unusual.forEach((bill) => {
    const mismatch =
      bill.difference > Math.max(100, Math.abs(bill.total) * 0.05);
    alerts.push({
      category: mismatch ? "ยอดเอกสารไม่ตรง" : "บิลมูลค่าสูง",
      icon: mismatch ? "≠" : "↗",
      title: `เอกสาร ${bill.docNo}`,
      description: `${bill.date} · ${mismatch ? `ยอดเอกสาร ${money(bill.total)} · ` : ""}ตรวจ VAT/ส่วนลดและเอกสารต้นทาง`,
      value: money(mismatch ? bill.difference : bill.total),
      caption: mismatch ? "ส่วนต่างที่ควรตรวจสอบ" : "มูลค่าเอกสาร",
      bill,
    });
  });
  element("alerts").replaceChildren();
  alerts.forEach((alert) => {
    const row = node("article", "", `alert${alert.yellow ? " yellow" : ""}`),
      action = node("button", "ตรวจสอบ →", "alert-action");
    const icon = node("span", alert.icon, "alert-icon");
    icon.setAttribute("aria-hidden", "true");
    const content = node("div", "", "alert-content");
    content.append(
      node("span", alert.category, "alert-category"),
      node("h3", alert.title),
      node("p", alert.description),
    );
    const metric = node("div", "", "alert-metric");
    metric.append(node("strong", alert.value), node("small", alert.caption));
    action.setAttribute("aria-label", `ตรวจสอบ ${alert.title}`);
    row.append(icon, content, metric);
    action.type = "button";
    const open = () =>
      openDetail(
        alert.product ? "stock" : alert.bill ? "bill" : alert.detail,
        alert.bill,
        alert.product,
      );
    row.append(action);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `ตรวจสอบ ${alert.title}`);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    element("alerts").append(row);
  });
  if (!alerts.length)
    element("alerts").append(
      node(
        "p",
        "ไม่พบการเตือนตามเกณฑ์ที่ตรวจได้ (ไม่รวมสต๊อก/ต้นทุนที่ไม่มีข้อมูล)",
        "note",
      ),
    );
  element("alert-count").textContent = `${alerts.length} เรื่อง`;
  element("updated").textContent =
    `ช่วง ${current.start} – ${current.end} · ${number.format(current.count)} เอกสาร · อัปเดต ${new Date(current.updatedAt).toLocaleString("th-TH")}`;
}
function openDetail(kind, bill, product) {
  if (!current) return;
  element("detail-title").textContent = {
    net: "เอกสารขายและรับคืน",
    activity: "จำนวนบิลขายและยอดเฉลี่ยต่อบิล",
    growth: "เปรียบเทียบช่วงเวลา",
    target: "ความคืบหน้าเป้ายอดขาย",
    bill: "ตรวจสอบเอกสาร",
    stock: "ตรวจสอบสินค้าสต๊อกใกล้หมด",
  }[kind];
  const body = element("detail-body");
  body.replaceChildren();
  body.append(
    node("p", `ช่วงวันที่ ${current.start} – ${current.end}`, "detail-period"),
  );
  const metrics = node("div", "", "detail-metrics");
  function metric(label, value, caption = "", tone = "") {
    const card = node("div", "", "detail-stat");
    card.append(
      node("span", label),
      node("strong", value, tone),
      node("small", caption),
    );
    metrics.append(card);
  }
  let explanation = "",
    caution = "";
  if (kind === "stock") {
    body.append(node("h3", product.name || product.code, "detail-table-title"));
    metric("รหัสสินค้า", product.code, "สินค้า Top 5 ตามยอดขายสุทธิ");
    metric(
      "คงเหลือในทะเบียน",
      `${number.format(product.stock)} ${product.unit || "หน่วยมาตรฐาน"}`,
      "ยอดทะเบียนปัจจุบัน ไม่ใช่ยอดย้อนหลัง",
      "warning",
    );
    metric("ยอดรายการขายสุทธิ", money(product.sales), "ตามช่วงวันที่ที่เลือก");
    explanation =
      "สินค้านี้อยู่ใน 5 อันดับทำยอดสูงสุด มียอดขายสุทธิเป็นบวก และยอดคงเหลือในทะเบียนไม่เกิน 5 หน่วยมาตรฐาน จึงควรตรวจสอบความพร้อมของสินค้าก่อนรับออเดอร์เพิ่ม";
    caution =
      "ข้อมูลคงเหลือจากทะเบียนสินค้า SML ไม่ใช่สต๊อกพร้อมขายสด ยังไม่หักยอดจองหรือแสดงสินค้าแยกคลัง ไม่สามารถสรุปจำนวนวันที่ขายได้หรือจำนวนที่ควรสั่งซื้อจากยอดนี้เพียงอย่างเดียว";
  }
  if (kind === "net") {
    metric(
      "ยอดขายสุทธิ",
      money(current.net),
      "หลังหักรับคืน / ลดหนี้",
      "positive",
    );
    metric("ขายและเพิ่มหนี้", money(current.sales), "ยอดรวมตามเอกสาร");
    metric("รับคืน / ลดหนี้", money(current.returns), "ยอดที่หักออกจากการขาย");
    explanation =
      "ยอดขายสุทธิ = ยอดขาย + เพิ่มหนี้ − รับคืน / ลดหนี้ ใช้ดูภาพรวมการขายตามช่วงวันที่เลือก";
    caution =
      "ยอดตามเอกสาร ไม่ใช่เงินสดที่รับแล้ว และไม่ใช่กำไร ตัดเอกสารยกเลิกและสำเนา";
  }
  if (kind === "activity") {
    metric(
      "จำนวนบิลขาย",
      current.salesInvoiceCount == null
        ? "—"
        : number.format(current.salesInvoiceCount) + " บิล",
      "เฉพาะเอกสารขาย",
    );
    metric(
      "ยอดเฉลี่ยต่อบิล",
      current.averageSale == null
        ? "ยังไม่มีบิลขาย"
        : money(current.averageSale),
      "ก่อนหักรับคืน",
    );
    explanation =
      "ยอดเฉลี่ยต่อบิล = ยอดรวมเอกสารขาย ÷ จำนวนบิลขายทั้งหมด ช่วยดูว่าจะเพิ่มยอดด้วยจำนวนบิล หรือเพิ่มมูลค่าต่อบิล";
    caution =
      "ไม่รวมเพิ่มหนี้ รับคืน เอกสารยกเลิก และสำเนา ค่าเฉลี่ยไม่ใช่ยอดขายสุทธิต่อบิล";
  }
  if (kind === "growth") {
    metric("ยอดขายสุทธิปัจจุบัน", money(current.net), "ช่วงวันที่เลือก");
    metric(
      "เทียบเดือนก่อน · MoM",
      percent(current.mom),
      money(current.previousNet),
      current.mom == null ? "" : current.mom < 0 ? "negative" : "positive",
    );
    metric(
      "เทียบปีก่อน · YoY",
      percent(current.yoy),
      money(current.yearNet),
      current.yoy == null ? "" : current.yoy < 0 ? "negative" : "positive",
    );
    explanation =
      "การเติบโต = (ยอดปัจจุบัน − ยอดช่วงก่อน) ÷ ยอดช่วงก่อน × 100 ใช้ MoM ดูแนวโน้มระยะสั้น และ YoY ประกอบการดูฤดูกาล";
    caution =
      "เลื่อนวันที่ย้อนหลังตามเดือนและปี จำกัดวันตามสิ้นเดือน จำนวนวันอาจต่างกัน ไม่คำนวณ % เมื่อยอดฐานเป็นศูนย์หรือติดลบ";
  }
  if (kind === "target") {
    const target = targetValue();
    metric(
      "เป้ายอดขาย",
      target ? money(target) : "ยังไม่ตั้งเป้า",
      "สำหรับช่วงวันที่เลือก",
    );
    metric(
      "ทำได้แล้ว",
      money(current.net),
      target
        ? number.format((current.net / target) * 100) + "% ของเป้า"
        : "กรอกเป้าในช่องด้านบน",
    );
    metric(
      target && current.net >= target ? "เกินเป้าแล้ว" : "ยอดที่ต้องทำเพิ่ม",
      target ? money(Math.abs(target - current.net)) : "—",
      "เทียบกับยอดขายสุทธิ",
    );
    explanation = target
      ? "ใช้ยอดที่ต้องทำเพิ่มกำหนดงานให้ทีมขาย ความคืบหน้าคำนวณจากยอดขายสุทธิ ÷ เป้า × 100"
      : "ปิดหน้าต่างนี้แล้วกรอกเป้ามากกว่า 0 บาทในช่องด้านบน เพื่อดูความคืบหน้าและยอดที่ต้องทำเพิ่ม";
    caution =
      "เป้าที่กรอกเอง เก็บเฉพาะเบราว์เซอร์นี้ แยกตามช่วงวันที่ ไม่ใช่เป้าที่ดึงจาก SML";
  }
  if (kind === "bill") {
    metric("เลขที่เอกสาร", bill.docNo, bill.date);
    metric("ยอดเอกสาร", money(bill.total), "มูลค่าตามหัวเอกสาร");
    metric(
      "ยอดรายการ",
      bill.lineTotal == null ? "ไม่มีรายการ" : money(bill.lineTotal),
      "รวมรายการในเอกสาร",
    );
    const mismatch =
      bill.difference > Math.max(100, Math.abs(bill.total) * 0.05);
    const highValue =
      bill.total > 100000 &&
      current.averageSale != null &&
      bill.total > current.averageSale * 3;
    const reasons = [];
    if (highValue || !mismatch)
      reasons.push(
        `บิลมูลค่า ${money(bill.total)} ถูกจัดเป็นบิลมูลค่าสูง ตามเกณฑ์มากกว่า ฿100,000 และมากกว่า 3 เท่าของค่าเฉลี่ยบิลขายในช่วงที่เลือก จึงควรให้ความสำคัญในการติดตาม ไม่ได้หมายความว่าบิลมีปัญหา`,
      );
    if (mismatch)
      reasons.push(
        `ยอดเอกสารกับยอดรายการต่างกัน ${money(bill.difference)} เกินทั้ง ฿100 และ 5% ของมูลค่าเอกสาร จึงควรตรวจสอบที่มาของส่วนต่างก่อนสรุปว่าข้อมูลผิด`,
      );
    explanation = reasons.join("\n\n");
    caution =
      "ระบบตรวจเฉพาะยอดเงินตามเอกสาร ยังไม่ได้ตรวจการรับชำระเงินจริง การส่งมอบ หรือกำไรของบิล ส่วนต่างอาจเกิดจาก VAT หรือส่วนลด ห้ามสรุปว่าเป็นบิลผิดหรือค้างชำระจากการแจ้งเตือนนี้เพียงอย่างเดียว";
  }
  body.append(metrics);
  const insight = node("section", "", "detail-insight");
  insight.append(
    node(
      "h3",
      kind === "bill"
        ? "ทำไมเอกสารนี้จึงถูกแจ้งเตือน?"
        : "อ่านตัวเลขเพื่อใช้งาน",
    ),
    node("p", explanation),
  );
  body.append(insight);
  if (kind === "stock") {
    const section = node("section", "", "bill-next-steps");
    section.append(node("h3", "ควรให้ทีมตรวจอะไรต่อ?"));
    const list = node("ol", "");
    for (const [owner, instruction] of [
      [
        "คลังสินค้า",
        "ตรวจนับสินค้าจริง แยกยอดจองและสินค้าพร้อมขาย รวมถึงสินค้าระหว่างรับเข้า",
      ],
      [
        "จัดซื้อ",
        "ตรวจใบสั่งซื้อค้างรับและระยะเวลาจัดส่ง ก่อนตัดสินใจเติมสินค้า",
      ],
      [
        "ทีมขาย",
        "ยืนยันสินค้าพร้อมส่งก่อนรับออเดอร์ และเตรียมสินค้าอื่นทดแทนหากจำเป็น",
      ],
    ]) {
      const item = node("li", "");
      item.append(node("strong", owner), node("p", instruction));
      list.append(item);
    }
    section.append(list);
    body.append(section);
  }
  if (kind === "bill") {
    const mismatch =
      bill.difference > Math.max(100, Math.abs(bill.total) * 0.05);
    const actions = mismatch
      ? [
          [
            "ฝ่ายบัญชี",
            "เทียบยอดหัวเอกสารกับรายการ ตรวจ VAT ส่วนลด และรายการปรับปรุง เพื่ออธิบายส่วนต่าง",
          ],
          ["ทีมขาย", "ยืนยันราคา จำนวนสินค้า และเงื่อนไขส่วนลดกับเอกสารต้นทาง"],
          [
            "ผู้บริหาร",
            "ให้ผู้รับผิดชอบสรุปสาเหตุและผลกระทบก่อนอนุมัติการแก้ไขข้อมูล",
          ],
        ]
      : [
          [
            "ทีมขาย",
            "ยืนยันราคา จำนวนสินค้า และส่วนลดของออเดอร์ใหญ่ พร้อมติดตามความต้องการซื้อครั้งถัดไป",
          ],
          [
            "คลัง / ทีมส่งมอบ",
            "ตรวจสอบสินค้าพร้อมส่งและกำหนดส่งมอบ เพื่อดูแลออเดอร์สำคัญให้ครบถ้วน",
          ],
          [
            "ฝ่ายบัญชี",
            "ตรวจเงื่อนไขชำระเงินและสถานะรับชำระจากระบบต้นทาง ไม่ใช่จากสัญญาณเตือนนี้",
          ],
        ];
    const section = node("section", "", "bill-next-steps");
    section.append(node("h3", "มอบหมายให้ทีมตรวจอะไรต่อ?"));
    const list = node("ol", "");
    actions.forEach(([owner, instruction]) => {
      const item = node("li", "");
      item.append(node("strong", owner), node("p", instruction));
      list.append(item);
    });
    section.append(list);
    body.append(section);
  }
  if (kind === "growth") {
    const periods = node("div", "", "detail-comparisons");
    periods.append(
      node(
        "p",
        `เดือนก่อน · ${current.previous.start} – ${current.previous.end}`,
      ),
      node("p", `ปีก่อน · ${current.year.start} – ${current.year.end}`),
    );
    body.append(periods);
  }
  const note = node("section", "", "help-caution");
  note.append(node("h3", "ข้อควรทราบ"), node("p", caution));
  body.append(note);
  if (["net", "bill", "target"].includes(kind)) {
    body.append(
      node(
        "h3",
        bill ? "รายการเอกสารที่ตรวจสอบ" : "เอกสารล่าสุดในช่วงนี้",
        "detail-table-title",
      ),
    );
    if (!bill)
      body.append(
        node(
          "p",
          "แสดงหน้าละ 5 รายการ จากเอกสารล่าสุดไม่เกิน 100 รายการ รวมขาย / เพิ่มหนี้ / รับคืน โดยยอดสรุปคำนวณจากเอกสารทั้งหมด",
          "note",
        ),
      );
    const table = node("table", ""),
      head = node("tr", ""),
      thead = node("thead", ""),
      tbody = node("tbody", "");
    ["วันที่ / เอกสาร", "ประเภท", "ยอดเอกสาร", "ยอดรายการ"].forEach((label) =>
      head.append(node("th", label)),
    );
    thead.append(head);
    table.append(thead);
    const invoices = bill ? [bill] : current.bills;
    let invoicePage = 0;
    const pageSize = 5,
      totalPages = Math.max(1, Math.ceil(invoices.length / pageSize));
    const pagination = node("nav", "", "detail-pagination");
    pagination.setAttribute("aria-label", "หน้าเอกสารล่าสุด");
    const previous = node("button", "← ก่อนหน้า"),
      next = node("button", "ถัดไป →"),
      info = node("span", "");
    previous.type = next.type = "button";
    previous.setAttribute("aria-label", "เอกสารหน้าก่อนหน้า");
    next.setAttribute("aria-label", "เอกสารหน้าถัดไป");
    info.setAttribute("role", "status");
    pagination.append(previous, info, next);
    function renderInvoices() {
      tbody.replaceChildren();
      const offset = invoicePage * pageSize;
      invoices.slice(offset, offset + pageSize).forEach((invoice) => {
        const row = node("tr", "");
        [
          invoice.date + " / " + invoice.docNo,
          { 44: "ขาย", 46: "เพิ่มหนี้", 48: "รับคืน/ลดหนี้" }[invoice.flag],
          money(invoice.total),
          invoice.lineTotal == null ? "ไม่มีรายการ" : money(invoice.lineTotal),
        ].forEach((value) => row.append(node("td", value)));
        tbody.append(row);
      });
      if (!invoices.length) {
        const row = node("tr", ""),
          cell = node("td", "ไม่พบเอกสารในช่วงวันที่เลือก");
        cell.colSpan = 4;
        row.append(cell);
        tbody.append(row);
      }
      previous.disabled = invoicePage === 0;
      next.disabled = invoicePage >= totalPages - 1;
      info.textContent = invoices.length
        ? `หน้า ${invoicePage + 1} / ${totalPages} · ${offset + 1}–${Math.min(offset + pageSize, invoices.length)} จาก ${invoices.length} รายการ`
        : "0 รายการ";
    }
    previous.addEventListener("click", () => {
      invoicePage = Math.max(0, invoicePage - 1);
      renderInvoices();
    });
    next.addEventListener("click", () => {
      invoicePage = Math.min(totalPages - 1, invoicePage + 1);
      renderInvoices();
    });
    renderInvoices();
    table.append(tbody);
    const scroll = node("div", "", "detail-table-scroll");
    scroll.append(table);
    body.append(scroll);
    if (!bill) body.append(pagination);
  }
  if (!element("detail").open) element("detail").showModal();
}
async function refresh(silent = false) {
  if (!element("filters").reportValidity()) return;
  const start = element("start").value,
    end = element("end").value;
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365) {
    element("status").textContent =
      "กรุณาเลือกวันที่เริ่มก่อนวันสิ้นสุด และช่วงไม่เกิน 366 วัน";
    element("summary").hidden = true;
    current = null;
    return;
  }
  controller?.abort();
  controller = new AbortController();
  const activeController = controller,
    request = ++requestId;
  const timeout = setTimeout(() => activeController.abort(), 30000);
  element("refresh").disabled = true;
  if (!silent) element("summary").hidden = true;
  if (!silent) {
    element("detail").close();
    current = null;
  }
  if (!silent) element("status").textContent = "กำลังโหลดข้อมูล SML…";
  try {
    const response = await fetch(
      "/api/executive?" + new URLSearchParams({ start, end }),
      { signal: activeController.signal, cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
    if (request !== requestId) return;
    current = data;
    element("summary").hidden = false;
    if (!silent) loadTarget();
    render(!silent);
    loadSpark();
    element("status").textContent = data.count
      ? "พร้อมสรุป · คลิกตัวเลขเพื่อดูรายละเอียด"
      : "ไม่พบเอกสารในช่วงที่เลือก ลองเปลี่ยนวันที่";
  } catch (error) {
    if (request !== requestId) return;
    element("status").textContent =
      error.name === "AbortError"
        ? "การเชื่อมต่อหมดเวลา กรุณากดอัปเดตข้อมูลเพื่อลองใหม่"
        : error.message;
  } finally {
    clearTimeout(timeout);
    if (request === requestId) element("refresh").disabled = false;
  }
}
element("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  refresh();
});
["start", "end"].forEach((id) =>
  element(id).addEventListener("change", () => {
    controller?.abort();
    requestId++;
    current = null;
    element("refresh").disabled = false;
    element("summary").hidden = true;
    element("detail").close();
    element("status").textContent = "เปลี่ยนช่วงวันที่แล้ว กดอัปเดตข้อมูล";
  }),
);
["branches", "staff"].forEach((team) =>
  element(team + "-tab").addEventListener("click", () => {
    activeTeam = team;
    if (current) renderTeam();
  }),
);
document
  .querySelectorAll("[data-detail]")
  .forEach((button) =>
    button.addEventListener("click", () => openDetail(button.dataset.detail)),
  );
element("close").addEventListener("click", () => element("detail").close());
setInterval(() => {
  if (
    !document.hidden &&
    !element("refresh").disabled &&
    !element("detail").open
  )
    refresh(true);
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !element("detail").open) refresh();
});
refresh();
