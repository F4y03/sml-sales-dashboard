(() => {
  const byId = (id) => document.getElementById(id);
  const num = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
  const baht = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dayFormat = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const money = (value) => `฿${baht.format(value)}`;
  const date = (value) =>
    value
      ? dayFormat.format(new Date(`${value}T12:00:00`))
      : "ไม่มีบิลขายในช่วงนี้";
  const pageSize = 10;
  const skuLabel = (code) => `SKU-${code}`;
  const searchText = (item) =>
    `${item.code}\n${skuLabel(item.code)}\n${item.name}`.toLocaleLowerCase(
      "th-TH",
    );
  let active = false,
    data = null,
    scope = [],
    visible = [],
    page = 0,
    mode = "all";
  let controller,
    requestId = 0,
    reloadTimer,
    buyerController,
    buyerRequest = 0,
    buyerData,
    buyerPage = 0,
    selectedSku,
    opener,
    outsideDown = false;

  function node(tag, text = "", className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  const descending = (a, b) =>
    b.net - a.net || a.code.localeCompare(b.code, "th");
  const declining = (item) =>
    item.previousNet > 0 && item.net < item.previousNet;
  const unsold = (item) => item.registered && item.invoiceCount === 0;
  const change = (item) =>
    item.previousNet > 0
      ? ((item.net - item.previousNet) / item.previousNet) * 100
      : null;
  function changeLabel(item) {
    const percent = change(item);
    return percent === null
      ? "ไม่มีฐานบวกให้เทียบ"
      : `${percent > 0 ? "+" : ""}${num.format(percent)}%`;
  }
  function quantitiesCell(quantities) {
    const cell = node("td", "", "numeric quantity-lines");
    if (!quantities.length) cell.textContent = "—";
    quantities.forEach((quantity) =>
      cell.append(node("span", `${num.format(quantity.net)} ${quantity.unit}`)),
    );
    return cell;
  }
  function empty(body, count, text) {
    const row = node("tr"),
      cell = node("td", text, "empty-state empty-cell");
    cell.colSpan = count;
    row.append(cell);
    body.append(row);
  }
  function pager(prefix, index, count) {
    byId(`${prefix}-page-info`).textContent = count
      ? `${num.format(index * pageSize + 1)}–${num.format(Math.min((index + 1) * pageSize, count))} จาก ${num.format(count)} รายการ`
      : "0 รายการ";
    byId(`${prefix}-prev`).disabled = index === 0;
    byId(`${prefix}-next`).disabled = (index + 1) * pageSize >= count;
  }
  function status(text, error = false) {
    byId("performance-status").textContent = text;
    byId("performance-status").classList.toggle("error", error);
  }
  async function getJSON(url, signal) {
    const response = await fetch(url, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "ไม่พบข้อมูล API สินค้า กรุณารีสตาร์ตเซิร์ฟเวอร์ Dashboard แล้วลองใหม่",
      );
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (error.name !== "SyntaxError") throw error;
      throw new Error("ข้อมูลสินค้าจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณาลองใหม่");
    }
    if (!response.ok)
      throw new Error(result.error || "โหลดข้อมูลสินค้าไม่สำเร็จ กรุณาลองใหม่");
    return result;
  }

  function reset() {
    controller?.abort();
    requestId++;
    clearTimeout(reloadTimer);
    data = null;
    scope = [];
    visible = [];
    buyerCache.clear();
    openHighlight.best = openHighlight.watch = null;
    byId("performance-dashboard").hidden = true;
    if (byId("sku-detail").open) closeSku();
  }
  async function load(detail) {
    if (!detail.silent) reset();
    if (!active) return;
    if (!detail.valid) {
      status("กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน", true);
      byId("refresh").disabled = false;
      return;
    }
    const currentRequest = ++requestId;
    const currentController = new AbortController();
    controller = currentController;
    byId("refresh").disabled = true;
    status("กำลังวิเคราะห์ยอดขายสินค้าและเปรียบเทียบช่วงก่อนหน้าจาก SML…");
    try {
      const result = await getJSON(
        `/api/customer-insights/catalog?${new URLSearchParams({ start: detail.start, end: detail.end })}`,
        currentController.signal,
      );
      if (currentRequest !== requestId || !active) return;
      data = result;
      buyerCache.clear();
      data.products = result.products
        .filter(
          (item) =>
            !String(item.code ?? "")
              .replace(/^[\s\u200B-\u200D\uFEFF]+/u, "")
              .startsWith("ฝ"),
        )
        .map((item) => ({
          ...item,
          net: Number(item.net),
          previousNet: Number(item.previousNet),
          invoiceCount: Number(item.invoiceCount),
          buyerCount: Number(item.buyerCount),
        }));
      const category = byId("performance-category"),
        previousCategory = category.value;
      const groups = new Map(
        data.products.map((item) => [item.categoryCode, item.category]),
      );
      category.replaceChildren(new Option("ทุกหมวดหมู่", "*"));
      [...groups]
        .sort((a, b) => a[1].localeCompare(b[1], "th"))
        .forEach(([code, name]) => category.append(new Option(name, code)));
      category.value = groups.has(previousCategory) ? previousCategory : "*";
      byId("performance-dashboard").hidden = false;
      byId("performance-period").textContent =
        `${date(data.start)} – ${date(data.end)} · เทียบ ${date(data.previous.start)} – ${date(data.previous.end)} (${num.format(data.previous.days)} วันเท่ากัน)`;
      byId("performance-updated").textContent =
        `อัปเดต ${new Date(data.updatedAt).toLocaleString("th-TH")}`;
      animateCharts = !detail.silent;
      renderScope(detail.silent);
    } catch (error) {
      if (currentController.signal.aborted || currentRequest !== requestId)
        return;
      status(
        error.message === "Failed to fetch"
          ? "เชื่อมต่อ SML ไม่สำเร็จ กรุณากดอัปเดตข้อมูลเพื่อลองใหม่"
          : error.message,
        true,
      );
    } finally {
      if (currentRequest === requestId && active)
        byId("refresh").disabled = false;
    }
  }

  function renderScope(preservePage = false) {
    if (!data) return;
    const search = byId("performance-search")
        .value.trim()
        .toLocaleLowerCase("th-TH"),
      category = byId("performance-category").value;
    scope = data.products.filter(
      (item) =>
        (category === "*" || item.categoryCode === category) &&
        searchText(item).includes(search),
    );
    const total = scope.reduce((sum, item) => sum + item.net, 0),
      previous = scope.reduce((sum, item) => sum + item.previousNet, 0);
    byId("performance-net").textContent = money(total);
    byId("performance-net-change").textContent =
      `${changeLabel({ net: total, previousNet: previous })} · เทียบช่วงก่อนหน้า`;
    byId("performance-sold").textContent = num.format(
      scope.filter((item) => item.invoiceCount > 0).length,
    );
    byId("performance-unsold").textContent = num.format(
      scope.filter(unsold).length,
    );
    byId("performance-declining").textContent = num.format(
      scope.filter(declining).length,
    );
    // renderSummaryCharts consumes the one-shot animate flag, so read it first.
    const animateRows = animateCharts;
    renderSummaryCharts(total, previous);
    renderHighlights(total, animateRows);
    status(
      scope.length
        ? `พบ ${num.format(scope.length)} รหัสสินค้า · คลิกสินค้าเพื่อดูจำนวนขายและลูกค้าที่ซื้อ`
        : "ไม่พบสินค้าตามคำค้นหาและหมวดหมู่ที่เลือก",
    );
    if (preservePage !== true) page = 0;
    renderTable();
  }
  // Summary charts animate only right after data loads, not on every search keystroke.
  let animateCharts = false,
    stopGrow = null;
  const shortMoney = (n) => {
    const a = Math.abs(n),
      text =
        a >= 1e6
          ? (a / 1e6).toFixed(2) + "M"
          : a >= 1e3
            ? (a / 1e3).toFixed(1) + "K"
            : num.format(Math.round(a));
    return (n < 0 ? "−฿" : "฿") + text;
  };
  function growBars(draw, animate) {
    stopGrow?.();
    stopGrow = null;
    if (!animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return draw(1);
    const began = performance.now();
    let raf;
    const frame = (now) => {
      const t = Math.min(1, (now - began) / 900);
      draw(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    draw(0);
    raf = requestAnimationFrame(frame);
    stopGrow = () => cancelAnimationFrame(raf);
  }
  function renderSummaryCharts(total, previous) {
    const svgNode = (tag, attrs = {}, text = "") => {
      const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        tag,
      );
      for (const [key, value] of Object.entries(attrs))
        element.setAttribute(key, value);
      element.textContent = text;
      return element;
    };
    const registered = scope.filter((item) => item.registered).length;
    const comparable = scope.filter((item) => item.previousNet > 0).length;
    const animate = animateCharts;
    animateCharts = false;
    const cards = [
      ["net", total, previous, "ยอดสุทธิเทียบช่วงก่อนหน้า"],
      [
        "sold",
        scope.filter((item) => item.invoiceCount > 0).length,
        scope.length,
        "จากสินค้าทั้งหมดตามตัวกรอง",
        "#d90a0a",
        "มีบิลขาย",
        "ยังไม่มีบิลขาย",
      ],
      [
        "unsold",
        scope.filter(unsold).length,
        registered,
        "จากสินค้าในทะเบียนตามตัวกรอง",
        "#d90a0a",
        "ยังไม่มีบิลขาย",
        "มีบิลขายแล้ว",
      ],
      [
        "declining",
        scope.filter(declining).length,
        comparable,
        "จากสินค้าที่ช่วงก่อนมียอดสุทธิเป็นบวก",
        "#d90a0a",
        "ยอดขายลดลง",
        "ยอดขายไม่ลดลง",
      ],
    ];
    for (const [key, value, base, caption, color, label, rest] of cards) {
      const card = byId(`performance-${key}`).closest(".summary-card");
      let chart = card.querySelector(".performance-summary-chart");
      if (!chart) {
        chart = node("span", "", "summary-breakdown performance-summary-chart");
        card.append(chart);
      }
      chart.replaceChildren(node("span", caption, "summary-chart-caption"));
      if (!scope.length) {
        chart.append(
          node("span", "ไม่มีข้อมูลตามตัวกรอง", "summary-chart-empty"),
        );
        continue;
      }
      if (key === "net") {
        const svg = svgNode("svg", {
          viewBox: "0 0 280 150",
          "aria-hidden": "true",
          class: "performance-comparison",
        });
        const min = Math.min(0, value, base),
          max = Math.max(0, value, base);
        const y = (n) => 124 - ((n - min) / (max - min || 1)) * 96;
        svg.append(
          svgNode("line", {
            x1: 15,
            x2: 265,
            y1: y(0),
            y2: y(0),
            class: "comparison-baseline",
          }),
        );
        const bars = [base, value].map((amount, index) => {
          const x = 50 + index * 120,
            rect = svgNode("rect", {
              x,
              width: 60,
              rx: 4,
              class: `comparison-bar${index ? " selected" : ""}${amount < 0 ? " negative" : ""}`,
            }),
            label = svgNode("text", { x: x + 30, "text-anchor": "middle", class: "comparison-amount" }, shortMoney(amount));
          svg.append(
            rect,
            label,
            svgNode(
              "text",
              { x: x + 30, y: 146, "text-anchor": "middle", class: "comparison-label" },
              index ? "ช่วงที่เลือก" : "ช่วงก่อนหน้า",
            ),
          );
          return { amount, rect, label };
        });
        // Bars grow out of the zero line; value labels ride on the bar ends.
        growBars((p) => {
          for (const { amount, rect, label } of bars) {
            const end = y(amount * p),
              top = Math.min(y(0), end),
              height = Math.max(1, Math.abs(end - y(0)));
            rect.setAttribute("y", top);
            rect.setAttribute("height", height);
            label.setAttribute("y", amount < 0 ? top + height + 13 : top - 6);
            label.style.opacity = p;
          }
        }, animate);
        chart.append(svg);
        const legend = node("span", "", "performance-comparison-legend");
        for (const [label, amount] of [
          ["ช่วงก่อนหน้า", base],
          ["ช่วงที่เลือก", value],
        ]) {
          const row = node("span", "", "performance-comparison-value");
          row.append(node("span", label), node("b", money(amount)));
          legend.append(row);
        }
        chart.append(legend);
      } else {
        const percent = base ? (value / base) * 100 : 0,
          count = (n) => `${num.format(n)} รหัส`;
        const { ring } = summaryRing({
          className: "summary-donut",
          centerClass: "summary-donut-center",
          box: 140,
          r: 52,
          focusable: false,
          segments: base
            ? [
                { share: percent, color, value: count(value), label, sub: `${num.format(percent)}%` },
                { share: 100 - percent, color: "#9a9ca5", value: count(base - value), label: rest, sub: `${num.format(100 - percent)}%` },
              ]
            : [],
          center: {
            value: percent,
            text: (v) => (base ? `${num.format(v)}%` : "—"),
            label: "ของกลุ่มอ้างอิง",
          },
          animate: animate && base > 0,
        });
        chart.append(
          ring,
          node(
            "span",
            base
              ? `${num.format(value)} จาก ${num.format(base)} รหัสสินค้า`
              : "ไม่มีสินค้าในกลุ่มอ้างอิง",
            "performance-chart-note",
          ),
        );
      }
    }
  }
  // ---------- Best sellers / products to watch ----------
  // Rows are expandable buttons; one open row per card. Names are set with textContent, never HTML.
  const pct1 = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const highlightLimits = { best: 5, watch: 5 },
    openHighlight = { best: null, watch: null },
    buyerCache = new Map();
  let highlightTotal = 0;
  // Percent of a whole; null when the base is not positive, so callers print "–" instead of NaN / Infinity.
  const shareOf = (part, whole) =>
    whole > 0 && Number.isFinite(part) ? (part / whole) * 100 : null;
  const pctText = (value) =>
    value === null || !Number.isFinite(value) ? "–" : `${pct1.format(value)}%`;
  const dropOf = (row) => shareOf(row.prev - row.now, row.prev);
  const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const bestRows = () =>
    scope
      .filter((item) => item.net > 0 && item.invoiceCount > 0)
      .sort(descending)
      .slice(0, highlightLimits.best)
      .map((item) => ({
        item,
        name: item.name,
        sku: item.code,
        amt: item.net,
        cust: item.buyerCount,
        bills: item.invoiceCount,
      }));
  const watchRows = () =>
    scope
      .filter(declining)
      .sort(
        (a, b) =>
          b.previousNet - b.net - (a.previousNet - a.net) ||
          a.code.localeCompare(b.code),
      )
      .slice(0, highlightLimits.watch)
      .map((item) => ({
        item,
        name: item.name,
        sku: item.code,
        prev: item.previousNet,
        now: item.net,
      }));
  function renderHighlights(total, animate = false) {
    highlightTotal = total;
    renderBest(animate);
    renderWatch(animate);
  }
  function highlightRow(list, row, index) {
    const wrap = node("div", "", "ph-item"),
      toggle = node("button", "", "ph-toggle"),
      detail = node("div", "", "ph-detail"),
      inner = node("div", "", "ph-detail-inner");
    wrap.style.setProperty("--i", index);
    wrap.dataset.sku = row.sku;
    toggle.type = "button";
    toggle.id = `ph-${list}-row-${index}`;
    detail.id = `ph-${list}-detail-${index}`;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", detail.id);
    detail.setAttribute("role", "region");
    detail.setAttribute("aria-labelledby", toggle.id);
    detail.inert = true;
    detail.append(inner);
    wrap.append(toggle, detail);
    toggle.addEventListener("click", () =>
      setHighlightOpen(list, wrap, row, toggle.getAttribute("aria-expanded") !== "true"),
    );
    return { wrap, toggle, inner };
  }
  function setHighlightOpen(list, wrap, row, open) {
    const container = byId(`performance-${list}`);
    container.querySelectorAll(".ph-item.is-open").forEach((other) => {
      if (other === wrap) return;
      other.classList.remove("is-open");
      other.querySelector(".ph-toggle").setAttribute("aria-expanded", "false");
      other.querySelector(".ph-detail").inert = true;
    });
    wrap.classList.toggle("is-open", open);
    wrap.querySelector(".ph-toggle").setAttribute("aria-expanded", String(open));
    wrap.querySelector(".ph-detail").inert = !open;
    openHighlight[list] = open ? row.sku : null;
    if (open) (list === "best" ? fillBest : fillWatch)(wrap.querySelector(".ph-detail-inner"), row);
  }
  function nameBlock(row, meta) {
    const block = node("span", "", "ph-name"),
      title = node("strong", row.name);
    title.title = row.name;
    block.append(title, meta);
    return block;
  }
  function amountBlock(value, sub, className = "") {
    const block = node("span", "", `ph-amount${className ? ` ${className}` : ""}`);
    block.append(node("b", value), node("small", sub));
    return block;
  }
  const chevron = () => {
    const arrow = node("span", "▾", "ph-chevron");
    arrow.setAttribute("aria-hidden", "true");
    return arrow;
  };
  function finishList(container, count, emptyText, animate) {
    clearTimeout(container.phTimer);
    if (!count) container.append(node("p", emptyText, "empty-state ph-empty"));
    if (!animate || reducedMotion()) return;
    void container.offsetWidth;
    container.classList.add("is-animating");
    // Drop the class once the stagger has played, so later re-renders (search keystrokes) don't replay it.
    container.phTimer = setTimeout(
      () => container.classList.remove("is-animating"),
      1500,
    );
  }
  function renderBest(animate = false) {
    const container = byId("performance-best"),
      rows = bestRows(),
      sum = rows.reduce((total, row) => total + row.amt, 0),
      leader = rows[0]?.amt || 0;
    container.classList.remove("is-animating");
    container.replaceChildren();
    byId("ph-best-sum").textContent = rows.length ? money(sum) : "–";
    byId("ph-best-share").textContent = rows.length
      ? pctText(shareOf(sum, highlightTotal))
      : "–";
    rows.forEach((row, index) => {
      const { wrap, toggle } = highlightRow("best", row, index),
        rank = node("span", String(index + 1), `ph-rank${index < 3 ? ` is-top${index + 1}` : ""}`),
        meta = node("small", "", "ph-meta"),
        bar = node("span", "", "ph-bar"),
        fill = node("i", "", "ph-fill");
      meta.append(
        node("code", skuLabel(row.sku)),
        document.createTextNode(
          ` · ${num.format(row.cust)} ลูกค้า · ${num.format(row.bills)} บิล`,
        ),
      );
      fill.style.width = `${leader > 0 ? Math.max(0, (row.amt / leader) * 100) : 0}%`;
      bar.setAttribute("aria-hidden", "true");
      bar.append(fill);
      toggle.append(
        rank,
        nameBlock(row, meta),
        amountBlock(money(row.amt), `${pctText(shareOf(row.amt, highlightTotal))} ของยอดขาย`),
        chevron(),
        bar,
      );
      toggle.setAttribute(
        "aria-label",
        `อันดับ ${index + 1} ${row.name} ยอดสุทธิ ${money(row.amt)} · กดเพื่อดูลูกค้าที่ซื้อมากที่สุด`,
      );
      container.append(wrap);
      if (openHighlight.best === row.sku) setHighlightOpen("best", wrap, row, true);
    });
    if (openHighlight.best && !rows.some((row) => row.sku === openHighlight.best))
      openHighlight.best = null;
    finishList(
      container,
      rows.length,
      "ยังไม่มีสินค้าที่มียอดขายสุทธิเป็นบวกตามตัวกรอง",
      animate,
    );
  }
  function renderWatch(animate = false) {
    const container = byId("performance-watch"),
      rows = watchRows(),
      lost = rows.reduce((total, row) => total + (row.prev - row.now), 0),
      critical = rows.filter((row) => (dropOf(row) ?? 0) >= 90).length;
    container.classList.remove("is-animating");
    container.replaceChildren();
    byId("ph-watch-lost").textContent = rows.length ? `−${money(lost)}` : "–";
    byId("ph-watch-critical").textContent = rows.length
      ? `${num.format(critical)} จาก ${num.format(rows.length)} รายการ`
      : "–";
    rows.forEach((row, index) => {
      const { wrap, toggle } = highlightRow("watch", row, index),
        drop = dropOf(row),
        left = shareOf(row.now, row.prev),
        meta = node("small", "", "ph-meta"),
        bars = node("span", "", "ph-pair");
      meta.append(node("code", skuLabel(row.sku)));
      if (drop !== null && drop >= 50)
        meta.append(
          node(
            "b",
            drop >= 90 ? "วิกฤต" : "เฝ้าระวัง",
            `ph-level ${drop >= 90 ? "is-critical" : "is-warning"}`,
          ),
        );
      // Each row uses its own scale: the previous period is always the full track.
      for (const [label, amount, width, className] of [
        ["ช่วงก่อน", row.prev, 100, "is-previous"],
        ["ช่วงนี้", row.now, left === null ? 0 : Math.min(100, Math.max(0, left)), "is-current"],
      ]) {
        const line = node("span", "", `ph-pair-line ${className}`),
          track = node("span", "", "ph-bar"),
          fill = node("i", "", "ph-fill");
        track.setAttribute("aria-hidden", "true");
        fill.style.width = `${width}%`;
        track.append(fill);
        line.append(node("span", label, "ph-pair-label"), track, node("span", money(amount), "ph-pair-amount"));
        bars.append(line);
      }
      toggle.append(
        node("span", String(index + 1), "ph-rank is-watch"),
        nameBlock(row, meta),
        amountBlock(`−${money(row.prev - row.now)}`, `ลดลง ${pctText(drop)}`, "ph-negative"),
        chevron(),
        bars,
      );
      toggle.setAttribute(
        "aria-label",
        `อันดับ ${index + 1} ${row.name} ยอดลดลง ${money(row.prev - row.now)} (${pctText(drop)}) · ช่วงก่อน ${money(row.prev)} ช่วงนี้ ${money(row.now)} · กดเพื่อดูรายละเอียด`,
      );
      container.append(wrap);
      if (openHighlight.watch === row.sku) setHighlightOpen("watch", wrap, row, true);
    });
    if (openHighlight.watch && !rows.some((row) => row.sku === openHighlight.watch))
      openHighlight.watch = null;
    finishList(
      container,
      rows.length,
      "ไม่พบสินค้าที่มียอดลดลงจากฐานบวกในช่วงเปรียบเทียบ",
      animate,
    );
  }
  function detailLine(label, value, className = "") {
    const line = node("div", "", `ph-detail-line${className ? ` ${className}` : ""}`);
    line.append(node("span", label), node("b", value));
    return line;
  }
  function detailLink(text, item) {
    const link = node("button", text, "ph-link");
    link.type = "button";
    link.setAttribute("aria-haspopup", "dialog");
    link.setAttribute("aria-controls", "sku-detail");
    link.addEventListener("click", () => openSku(item, link));
    return link;
  }
  // Top buyers come from the same product-buyers API as the SKU popup, fetched once per product and period.
  function fillBest(inner, row) {
    if (!data) return;
    const snapshot = data,
      key = `${data.start}|${data.end}|${row.sku}`;
    inner.replaceChildren(node("p", "กำลังโหลดลูกค้าที่ซื้อมากที่สุด…", "ph-detail-status"));
    let pending = buyerCache.get(key);
    if (!pending) {
      pending = getJSON(
        `/api/customer-insights/product-buyers?${new URLSearchParams({ start: data.start, end: data.end, code: row.sku })}`,
      ).then((result) => result.buyers);
      buyerCache.set(key, pending);
      pending.catch(() => buyerCache.delete(key));
    }
    pending.then(
      (buyers) => {
        if (data !== snapshot || !inner.isConnected) return;
        const topBuyers = buyers.slice(0, 3),
          list = node("ol", "", "ph-buyers");
        topBuyers.forEach((buyer) => {
          const entry = node("li");
          entry.append(node("span", buyer.name), node("b", money(Number(buyer.net))));
          list.append(entry);
        });
        inner.replaceChildren(node("p", "ลูกค้าที่ซื้อมากที่สุด", "ph-detail-title"));
        if (topBuyers.length) inner.append(list);
        else inner.append(node("p", "ยังไม่มีลูกค้าที่มีรายการสินค้านี้ในช่วงนี้", "ph-detail-status"));
        if (buyers.length > 3)
          inner.append(node("p", `และอีก ${num.format(buyers.length - 3)} ราย`, "ph-detail-more"));
        const foot = node("div", "", "ph-detail-foot");
        foot.append(
          detailLine("เฉลี่ยต่อบิล", row.bills > 0 ? money(row.amt / row.bills) : "–"),
          detailLink("ดูลูกค้าทั้งหมด →", row.item),
        );
        inner.append(foot);
      },
      (error) => {
        if (data !== snapshot || !inner.isConnected) return;
        const retry = node("button", "ลองใหม่", "ph-link");
        retry.type = "button";
        retry.addEventListener("click", () => fillBest(inner, row));
        inner.replaceChildren(
          node(
            "p",
            error.message === "Failed to fetch" ? "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" : error.message,
            "ph-detail-status is-error",
          ),
          retry,
        );
      },
    );
  }
  function fillWatch(inner, row) {
    if (!data) return;
    const left = shareOf(row.now, row.prev),
      stock =
        row.item.stock == null || row.item.stock === ""
          ? null
          : Number(row.item.stock);
    const foot = node("div", "", "ph-detail-foot");
    foot.append(
      node(
        "span",
        `ช่วงก่อน ${date(data.previous.start)} – ${date(data.previous.end)} · ช่วงนี้ ${date(data.start)} – ${date(data.end)}`,
        "ph-detail-period",
      ),
      detailLink("ดูลูกค้าและสต็อก →", row.item),
    );
    inner.replaceChildren(
      detailLine("ยอดช่วงนี้เหลือ", left === null ? "–" : `${pct1.format(left)}% ของช่วงก่อน`),
      detailLine("ยอดที่หายไป", `−${money(row.prev - row.now)}`, "ph-negative"),
      // NULL stock means "no data", not zero.
      detailLine(
        "คงเหลือในทะเบียน",
        stock !== null && Number.isFinite(stock)
          ? `${num.format(stock)} ${row.item.stockUnit || "ไม่ระบุหน่วย"}`
          : "ไม่มีข้อมูล",
      ),
      foot,
    );
  }
  document.querySelectorAll("[data-ph-limit]").forEach((button) =>
    button.addEventListener("click", () => {
      const list = button.dataset.phList,
        limit = Number(button.dataset.phLimit);
      document
        .querySelectorAll(`[data-ph-list="${list}"]`)
        .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      if (highlightLimits[list] === limit) return;
      highlightLimits[list] = limit;
      if (data) (list === "best" ? renderBest : renderWatch)(true);
    }),
  );
  for (const [id, target] of [
    ["ph-best-all", "all"],
    ["ph-watch-all", "declining"],
  ])
    byId(id).addEventListener("click", () => {
      if (!data) return;
      mode = target;
      page = 0;
      renderTable();
      byId("performance-table-title").scrollIntoView({
        block: "start",
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    });


  function renderTable() {
    const modes = {
      all: [
        "สินค้าทั้งหมด",
        "เรียงยอดสุทธิสูงไปต่ำ รวมสินค้าจากทะเบียนและสินค้าที่มีรายการในสองช่วงเวลา",
        () => scope.slice().sort(descending),
      ],
      sold: [
        "สินค้าที่มีบิลขาย",
        "มีเอกสารขายอย่างน้อย 1 บิลในช่วงที่เลือก รวมรายการที่ยอดสุทธิไม่บวก",
        () => scope.filter((item) => item.invoiceCount > 0).sort(descending),
      ],
      best: [
        "สินค้าขายดี 10 อันดับ",
        "10 อันดับยอดสุทธิสูงสุด เฉพาะสินค้าที่มีบิลขายและยอดสุทธิเป็นบวก",
        () =>
          scope
            .filter((item) => item.invoiceCount > 0 && item.net > 0)
            .sort(descending)
            .slice(0, 10),
      ],
      slow: [
        "สินค้าขายน้อย 10 อันดับ",
        "10 อันดับยอดสุทธิต่ำสุดที่ยังเป็นบวกและมีบิลขาย เป็นการเปรียบเทียบในกลุ่มที่ค้นหา ไม่ใช่เกณฑ์ยอดขายเป้าหมาย",
        () =>
          scope
            .filter((item) => item.invoiceCount > 0 && item.net > 0)
            .sort((a, b) => a.net - b.net || a.code.localeCompare(b.code))
            .slice(0, 10),
      ],
      declining: [
        "สินค้าที่มียอดลดลง",
        "ยอดสุทธิน้อยกว่าช่วงก่อนหน้าที่มีฐานมากกว่า 0 เรียงตามยอดเงินที่ลดลงมากที่สุด",
        () =>
          scope
            .filter(declining)
            .sort(
              (a, b) =>
                b.previousNet - b.net - (a.previousNet - a.net) ||
                a.code.localeCompare(b.code),
            ),
      ],
      unsold: [
        "สินค้าที่ยังไม่มีบิลขาย",
        "สินค้าในทะเบียนที่ไม่มีเอกสารขายในช่วงที่เลือก อาจมีรับคืน/เพิ่มหนี้ เรียงคงเหลือในทะเบียนจากมากไปน้อย",
        () =>
          scope
            .filter(unsold)
            .sort(
              (a, b) =>
                (b.stock ?? -Infinity) - (a.stock ?? -Infinity) ||
                a.code.localeCompare(b.code),
            ),
      ],
      nonpositive: [
        "สินค้ามีบิลขาย แต่ยอดสุทธิไม่บวก",
        "มีเอกสารขาย แต่ยอดขาย + เพิ่มหนี้ − รับคืน ไม่เกิน 0 บาท ควรตรวจรายการศูนย์บาทหรือรับคืน",
        () =>
          scope
            .filter((item) => item.invoiceCount > 0 && item.net <= 0)
            .sort((a, b) => a.net - b.net || a.code.localeCompare(b.code)),
      ],
    };
    const [title, explanation, filter] = modes[mode];
    visible = filter();
    byId("performance-table-title").textContent = title;
    byId("performance-explanation").textContent =
      `${explanation} · ${num.format(visible.length)} รหัสสินค้า`;
    document
      .querySelectorAll("[data-performance-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.performanceFilter === mode),
        ),
      );
    const body = byId("performance-rows");
    body.replaceChildren();
    visible.slice(page * pageSize, (page + 1) * pageSize).forEach((item) => {
      const row = node("tr"),
        name = node("td"),
        button = node("button", item.name, "performance-product-button");
      button.type = "button";
      button.dataset.sku = item.code;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "sku-detail");
      button.addEventListener("click", () => openSku(item, button));
      name.append(
        button,
        node("small", `${skuLabel(item.code)} · ${item.category}`),
      );
      const statusText =
        item.invoiceCount === 0
          ? item.registered
            ? "ไม่มีบิลขาย"
            : "ไม่มีบิลขาย / ไม่พบในทะเบียน"
          : item.net <= 0
            ? "สุทธิไม่บวก"
            : declining(item)
              ? "ยอดลดลง"
              : "มีบิลขาย";
      name.append(
        node(
          "span",
          statusText,
          `product-status ${item.invoiceCount === 0 || item.net <= 0 || declining(item) ? "watch" : "good"}`,
        ),
      );
      const bills = node(
        "td",
        `${num.format(item.invoiceCount)} บิล`,
        "numeric",
      );
      bills.append(node("small", `${num.format(item.buyerCount)} ลูกค้า`));
      const trend = node(
        "td",
        changeLabel(item),
        `numeric ${declining(item) ? "performance-negative" : item.previousNet > 0 && item.net > item.previousNet ? "performance-positive" : ""}`,
      );
      trend.append(node("small", `ก่อนหน้า ${money(item.previousNet)}`));
      const stock = node(
        "td",
        item.stock == null
          ? "ไม่มีข้อมูล"
          : `${num.format(item.stock)} ${item.stockUnit}`,
        "numeric",
      );
      row.append(
        name,
        quantitiesCell(item.quantities),
        node(
          "td",
          money(item.net),
          `numeric${item.net < 0 ? " performance-negative" : ""}`,
        ),
        bills,
        trend,
        stock,
        node("td", date(item.lastSold)),
      );
      body.append(row);
    });
    if (!visible.length)
      empty(
        body,
        7,
        "ไม่พบสินค้าในกลุ่มนี้ ลองเปลี่ยนคำค้นหา หมวดหมู่ หรือกลุ่มสินค้า",
      );
    pager("performance", page, visible.length);
  }

  function closeSku() {
    if (byId("sku-detail").open) byId("sku-detail").close();
    buyerController?.abort();
    buyerRequest++;
    buyerController = null;
    buyerData = null;
    byId("sku-content").hidden = true;
    byId("sku-detail").setAttribute("aria-busy", "false");
    document.body.classList.remove("product-dialog-open");
    outsideDown = false;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  async function openSku(item, trigger) {
    if (!data || !active) return;
    buyerController?.abort();
    const currentController = new AbortController();
    buyerController = currentController;
    const currentRequest = ++buyerRequest;
    selectedSku = item;
    opener = trigger;
    buyerPage = 0;
    buyerData = null;
    const dialog = byId("sku-detail");
    byId("sku-title").textContent = item.name;
    byId("sku-subtitle").textContent =
      `${skuLabel(item.code)} · ${item.category} · ${date(data.start)} – ${date(data.end)}`;
    byId("sku-status").textContent = "กำลังโหลดจำนวนขายและลูกค้าที่มีรายการ…";
    byId("sku-status").hidden = false;
    byId("sku-content").hidden = true;
    byId("sku-retry").hidden = true;
    dialog.setAttribute("aria-busy", "true");
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("product-dialog-open");
    dialog.scrollTop = 0;
    try {
      const result = await getJSON(
        `/api/customer-insights/product-buyers?${new URLSearchParams({ start: data.start, end: data.end, code: item.code })}`,
        currentController.signal,
      );
      if (currentRequest !== buyerRequest) return;
      buyerData = result;
      const product = result.product;
      const selectedPeriod = `${date(result.start)} – ${date(result.end)}`;
      byId("sku-previous-period").textContent =
        `${date(result.previous.start)} – ${date(result.previous.end)}`;
      byId("sku-current-period").textContent = selectedPeriod;
      byId("sku-previous-net").textContent = money(product.previousNet);
      byId("sku-current-net").textContent = money(product.net);
      const difference = Number(product.net) - Number(product.previousNet);
      byId("sku-period-difference").textContent =
        difference === 0
          ? "ยอดขายสุทธิเท่ากับช่วงก่อน"
          : `ยอดขายสุทธิ${difference < 0 ? "ลดลง" : "เพิ่มขึ้น"} ${money(Math.abs(difference))} จากช่วงก่อน${Number(product.previousNet) > 0 ? ` (${num.format((Math.abs(difference) / Number(product.previousNet)) * 100)}%)` : " · ไม่มีฐานบวกสำหรับคำนวณเปอร์เซ็นต์"}`;
      byId("sku-period-explanation").textContent =
        `เปรียบเทียบกับช่วงก่อนหน้าที่มีจำนวนวันเท่ากัน โดยไม่ทับช่วงนี้ · ยอดขายและตารางลูกค้าด้านล่างใช้เฉพาะช่วงนี้: ${selectedPeriod} · ยอดสุทธิ = ขาย + เพิ่มหนี้ − รับคืน/ลดหนี้`;
      const stock =
        product.stock == null || product.stock === ""
          ? null
          : Number(product.stock);
      byId("sku-stock").textContent =
        stock !== null && Number.isFinite(stock)
          ? `${num.format(stock)} ${product.stockUnit || "ไม่ระบุหน่วย"}`
          : "ไม่มีข้อมูลคงเหลือ";
      byId("sku-stock-updated").textContent =
        `ดึงข้อมูล ${new Date(result.updatedAt).toLocaleString("th-TH")}`;
      byId("sku-net").textContent = money(product.net);
      byId("sku-change").textContent =
        `${changeLabel(product)} · เทียบ ${date(result.previous.start)} – ${date(result.previous.end)}`;
      byId("sku-sales").textContent = money(product.sales);
      byId("sku-added").textContent = `เพิ่มหนี้ ${money(product.added)}`;
      byId("sku-returns").textContent = money(product.returns);
      byId("sku-buyers-count").textContent =
        `${num.format(product.buyerCount)} ราย`;
      byId("sku-bills").textContent =
        `${num.format(product.invoiceCount)} บิลขาย`;
      const quantities = byId("sku-quantities");
      quantities.replaceChildren();
      product.quantities.forEach((quantity) => {
        const row = node("tr");
        row.append(node("td", quantity.unit));
        for (const key of ["sold", "added", "returned", "net"])
          row.append(node("td", num.format(quantity[key]), "numeric"));
        quantities.append(row);
      });
      if (!product.quantities.length)
        empty(
          quantities,
          5,
          "ไม่มีรายการขาย เพิ่มหนี้ หรือรับคืนของสินค้านี้ในช่วงที่เลือก",
        );
      renderBuyers();
      byId("sku-status").hidden = true;
      byId("sku-content").hidden = false;
    } catch (error) {
      if (currentController.signal.aborted || currentRequest !== buyerRequest)
        return;
      byId("sku-status").textContent =
        error.message === "Failed to fetch"
          ? "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่"
          : error.message;
      byId("sku-retry").hidden = false;
    } finally {
      if (currentRequest === buyerRequest) {
        dialog.setAttribute("aria-busy", "false");
        buyerController = null;
      }
    }
  }
  function renderBuyers() {
    const body = byId("sku-buyers");
    body.replaceChildren();
    buyerData.buyers
      .slice(buyerPage * pageSize, (buyerPage + 1) * pageSize)
      .forEach((buyer) => {
        const row = node("tr"),
          name = node("td", buyer.name);
        name.append(node("small", buyer.code || "ไม่ระบุรหัสลูกค้า"));
        row.append(
          name,
          quantitiesCell(buyer.quantities),
          node("td", num.format(buyer.invoiceCount), "numeric"),
          node("td", money(buyer.net), "numeric"),
          node("td", date(buyer.lastSold)),
        );
        body.append(row);
      });
    if (!buyerData.buyers.length)
      empty(body, 5, "ยังไม่มีลูกค้าที่มีรายการสินค้านี้ในช่วงวันที่เลือก");
    pager("sku", buyerPage, buyerData.buyers.length);
  }

  document.addEventListener("insights-view-change", (event) => {
    active = event.detail.view === "products";
    reset();
    byId("product-view").hidden = !active;
    if (active) load(event.detail);
  });
  document.addEventListener("insights-product-refresh", (event) => {
    if (active) load(event.detail);
  });
  document.addEventListener("insights-period-change", (event) => {
    if (!active) return;
    reset();
    byId("refresh").disabled = false;
    status(
      event.detail.valid
        ? "กำลังอัปเดตการวิเคราะห์สินค้าตามช่วงวันที่…"
        : "กรุณาเลือกช่วงวันที่ให้ถูกต้องและไม่เกิน 366 วัน",
      !event.detail.valid,
    );
    if (event.detail.valid)
      reloadTimer = setTimeout(() => load(event.detail), 250);
  });
  function searchSku(trigger) {
    const query = byId("performance-search")
      .value.trim()
      .toLocaleLowerCase("th-TH");
    const message = byId("performance-search-message");
    if (!query) {
      message.textContent = "กรุณาพิมพ์ SKU หรือชื่อสินค้า";
      byId("performance-search").focus();
      return;
    }
    if (!data) {
      message.textContent =
        "ข้อมูลสินค้ายังไม่พร้อม กรุณารอโหลดข้อมูลหรือกดอัปเดตข้อมูล";
      return;
    }
    const matches = data.products.filter((item) =>
      searchText(item).includes(query),
    );
    const exact =
      matches.find((item) => item.code.toLocaleLowerCase("th-TH") === query) ||
      matches.find(
        (item) => skuLabel(item.code).toLocaleLowerCase("th-TH") === query,
      );
    if (exact || matches.length === 1) {
      message.textContent = "";
      openSku(exact || matches[0], trigger);
      return;
    }
    byId("performance-category").value = "*";
    mode = "all";
    renderScope();
    message.textContent = matches.length
      ? `พบ ${num.format(matches.length)} สินค้า กรุณาเลือกสินค้าในตารางด้านล่าง หรือระบุ SKU ให้ครบ`
      : "ไม่พบสินค้า กรุณาตรวจสอบ SKU หรือชื่อสินค้า";
    if (matches.length)
      byId("performance-table-title").scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
  }
  byId("performance-search-button").addEventListener("click", (event) =>
    searchSku(event.currentTarget),
  );
  byId("performance-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      searchSku(event.currentTarget);
    }
  });
  byId("performance-search").addEventListener("input", () => {
    byId("performance-search-message").textContent = "";
    renderScope();
  });
  byId("performance-category").addEventListener("change", renderScope);
  document.querySelectorAll("[data-performance-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      mode = button.dataset.performanceFilter;
      page = 0;
      if (data) renderTable();
    }),
  );
  for (const [direction, delta] of [
    ["prev", -1],
    ["next", 1],
  ]) {
    byId(`performance-${direction}`).addEventListener("click", () => {
      page += delta;
      renderTable();
    });
    byId(`sku-${direction}`).addEventListener("click", () => {
      buyerPage += delta;
      renderBuyers();
    });
  }
  byId("sku-retry").addEventListener("click", () =>
    openSku(selectedSku, opener),
  );
  byId("sku-close").addEventListener("click", closeSku);
  byId("sku-detail").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSku();
  });
  byId("sku-detail").addEventListener("close", () => {
    if (
      !byId("sku-detail").open &&
      document.body.classList.contains("product-dialog-open")
    )
      closeSku();
  });
  function outside(event) {
    const bounds = byId("sku-detail").getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  }
  byId("sku-detail").addEventListener("pointerdown", (event) => {
    outsideDown = outside(event);
  });
  byId("sku-detail").addEventListener("click", (event) => {
    if (outsideDown && outside(event)) closeSku();
    outsideDown = false;
  });
  byId("sku-detail").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [
      ...byId("sku-detail").querySelectorAll(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((control) => control.getClientRects().length);
    if (
      (event.shiftKey && document.activeElement === controls[0]) ||
      (!event.shiftKey && document.activeElement === controls.at(-1))
    ) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  });
})();
