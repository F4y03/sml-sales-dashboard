(() => {
  const el = (id) => document.getElementById(id),
    format = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
  let chart = null,
    period = null,
    data = null,
    version = 0,
    controller;
  const safeText = (value) =>
    value == null || value === "" || String(value).trim() === "-"
      ? "-"
      : String(value).trim();
  const safeNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? format.format(num) : "-";
  };
  const label = (r) => {
    const name = safeText(r?.name);
    const code =
      r?.code != null &&
      String(r.code).trim() !== "" &&
      String(r.code).trim() !== name
        ? String(r.code).trim()
        : "";
    const unit =
      r?.unit != null && String(r.unit).trim() !== ""
        ? ` (${String(r.unit).trim()})`
        : "";
    return code ? `${name} · ${code}${unit}` : `${name}${unit}`;
  };
  window.addEventListener("dashboard-theme-change", () => {
    if (data) draw(data, false);
  });

  // ---- Doughnut (every view except the net-sales timeline) ----
  const SVG = "http://www.w3.org/2000/svg",
    R = 84,
    C = 2 * Math.PI * R,
    GAP = 2.4,
    DONUT_COLORS = [
      "#e10600",
      "#2f7fe0",
      "#f2a600",
      "#14a37f",
      "#8e5bd6",
      "#ff7a1a",
      "#18a8c4",
      "#e0479e",
      "#7fb83a",
      "#a0703c",
    ],
    OTHER_COLOR = "#7a7d86",
    NOUN = {
      group: "กลุ่มสินค้า",
      salesperson: "พนักงานขาย",
      customer: "ลูกค้า",
      branch: "สาขา",
      type: "ประเภทสินค้า",
      quantity: "รายการ",
      subgroup: "กลุ่มย่อย",
    };
  let donutFrame = 0,
    donutSlices = [],
    donutDraw = 0,
    pinnedKey = null;
  const reduceMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const compact = (v, qty) => {
    const n = Number(v) || 0,
      a = Math.abs(n),
      s =
        a >= 1e6
          ? (n / 1e6).toFixed(2) + "M"
          : a >= 1e3
            ? (n / 1e3).toFixed(1) + "K"
            : format.format(n);
    return qty ? s : "฿" + s;
  };
  const pct = (v, total) =>
    total > 0 ? ((Number(v) / total) * 100).toFixed(1) + "%" : "–";
  function donutCenter(labelText, valueText, subText) {
    el("donut-label").textContent = labelText;
    el("donut-value").textContent = valueText;
    el("donut-sub").textContent = subText;
  }
  const money = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  function clearDonut() {
    donutDraw++; // before removing rows, so their blur events see a stale chart
    cancelAnimationFrame(donutFrame);
    donutSlices = [];
    el("analysis-hover").hidden = true;
    el("analysis-hover").replaceChildren();
    el("donut-svg").replaceChildren();
    el("donut-legend").replaceChildren();
    el("analysis-donut").removeAttribute("data-active");
    donutCenter("", "", "");
  }
  function drawDonut(d, animate) {
    clearDonut();
    const isQty = d.unit === "quantity",
      noun = NOUN[d.mode] || "รายการ",
      total = d.rows.reduce((s, r) => s + (Number(r.value) || 0), 0),
      top = d.rows.slice(0, 10),
      rest = d.rows.slice(10),
      units = new Set(d.rows.map((r) => r.unit).filter(Boolean)),
      mixedUnits = isQty && units.size > 1,
      items = top.map((r, i) => ({
        name: label({ ...r, unit: "" }),
        value: Number(r.value) || 0,
        unit: isQty ? r.unit : "",
        color: DONUT_COLORS[i],
      }));
    if (rest.length)
      items.push({
        name: `อื่น ๆ (${rest.length} ${noun})`,
        value: rest.reduce((s, r) => s + (Number(r.value) || 0), 0),
        unit: isQty && !mixedUnits ? [...units][0] : "",
        color: OTHER_COLOR,
      });
    const positive = items.reduce((s, it) => s + Math.max(0, it.value), 0),
      svg = el("donut-svg"),
      g = document.createElementNS(SVG, "g"),
      track = document.createElementNS(SVG, "circle");
    svg.setAttribute("aria-label", d.title);
    g.setAttribute("transform", "rotate(-90 110 110)");
    for (const [k, v] of Object.entries({ cx: 110, cy: 110, r: R, class: "donut-track" }))
      track.setAttribute(k, v);
    g.append(track);
    const totalLabel = isQty ? "จำนวนรวม" : "ยอดรวม",
      totalText = (v) => (mixedUnits ? format.format(Math.round(v)) : compact(v, isQty)),
      totalSub = `${d.rows.length} ${noun}${mixedUnits ? " · หลายหน่วยนับ" : ""}`;
    let start = 0;
    items.forEach((it, i) => {
      const len = positive > 0 ? (Math.max(0, it.value) / positive) * C : 0,
        slice = document.createElementNS(SVG, "circle");
      for (const [k, v] of Object.entries({
        cx: 110,
        cy: 110,
        r: R,
        class: "donut-slice",
        stroke: it.color,
        "stroke-dashoffset": -start,
        "data-index": i,
      }))
        slice.setAttribute(k, v);
      donutSlices.push({ el: slice, start, len: Math.max(0, len - GAP) });
      start += len;
      g.append(slice);
      const li = document.createElement("li"),
        dot = document.createElement("i"),
        name = document.createElement("span"),
        value = document.createElement("span"),
        share = document.createElement("strong");
      li.tabIndex = 0;
      li.dataset.index = i;
      dot.style.background = it.color;
      name.className = "donut-name";
      name.textContent = it.name;
      name.title = it.name;
      value.className = "donut-amount";
      value.textContent = compact(it.value, isQty) + (it.unit ? ` ${it.unit}` : "");
      share.textContent = pct(it.value, total);
      li.append(dot, name, value, share);
      li.setAttribute(
        "aria-label",
        `${it.name} ${value.textContent} ${share.textContent}`,
      );
      el("donut-legend").append(li);
    });
    svg.append(g);
    // Hover summary box under the chart: built only from the rows already loaded (no extra SML query).
    const full = (v, unit) =>
      isQty
        ? `${format.format(v)}${unit ? ` ${unit}` : ""}`
        : `฿${money.format(v)}`;
    let pinned = items.findIndex((it) => `${d.mode}|${it.name}` === pinnedKey);
    if (pinned < 0) pinned = null;
    const hoverBox = el("analysis-hover");
    hoverBox.hidden = !d.rows.length;
    const hint = () => {
      const p = document.createElement("p");
      p.className = "analysis-hover-hint";
      p.textContent = `ชี้ที่${noun}ในกราฟหรือรายการเพื่อดูยอด สัดส่วน และอันดับ · คลิกเพื่อปักค้างไว้`;
      hoverBox.replaceChildren(p);
    };
    hint();
    const showHover = (i) => {
      const it = items[i],
        h = document.createElement("h3"),
        dot = document.createElement("i"),
        dl = document.createElement("dl");
      dot.style.background = it.color;
      h.append(dot, it.name);
      if (pinned === i) {
        const pin = document.createElement("small");
        pin.className = "analysis-hover-pin";
        pin.textContent = "ปักไว้ · คลิกอีกครั้งเพื่อยกเลิก";
        h.append(pin);
      }
      const add = (term, value) => {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = term;
        dd.textContent = value;
        dl.append(dt, dd);
      };
      const isOther = i >= top.length;
      add(isQty ? "จำนวน" : "ยอดขาย", full(it.value, it.unit));
      add("สัดส่วนจากทั้งหมด", pct(it.value, total));
      if (isOther) {
        add("รวม", `${rest.length} ${noun} (อันดับ ${top.length + 1}–${d.rows.length})`);
        hoverBox.replaceChildren(h, dl);
        const list = document.createElement("dl");
        list.className = "analysis-hover-list";
        list.setAttribute("aria-label", `รายการใน ${it.name}`);
        rest.forEach((r) => {
          const dt = document.createElement("dt"),
            dd = document.createElement("dd");
          dt.textContent = label(r);
          dd.textContent = full(Number(r.value) || 0, isQty ? r.unit : "");
          list.append(dt, dd);
        });
        hoverBox.append(list);
        return;
      }
      add("อันดับ", `${i + 1} จาก ${d.rows.length} ${noun}`);
      const upTo = d.rows
        .slice(0, i + 1)
        .reduce((s, r) => s + (Number(r.value) || 0), 0);
      add(`สะสมอันดับ 1–${i + 1}`, pct(upTo, total));
      // Gaps only compare like with like: skip when quantity rows use different units.
      const sameUnit = (r) => !isQty || r.unit === d.rows[i].unit;
      const prev = d.rows[i - 1],
        next = d.rows[i + 1];
      if (prev && sameUnit(prev))
        add(`ห่างจากอันดับ ${i} (${label({ ...prev, unit: "" })})`, full((Number(prev.value) || 0) - it.value, it.unit));
      if (next && sameUnit(next))
        add(`นำอันดับ ${i + 2} (${label({ ...next, unit: "" })})`, full(it.value - (Number(next.value) || 0), it.unit));
      hoverBox.replaceChildren(h, dl);
    };
    const drawId = donutDraw;
    const activate = (i) => {
      // Rows removed by a redraw can still fire blur/pointerleave: ignore the old chart's handlers.
      if (drawId !== donutDraw) return;
      const box = el("analysis-donut");
      box.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));
      if (i == null || !items[i]) {
        box.removeAttribute("data-active");
        donutCenter(totalLabel, totalText(total), totalSub);
        hint();
        return;
      }
      showHover(i);
      box.dataset.active = i;
      donutSlices[i].el.classList.add("is-active");
      el("donut-legend").children[i].classList.add("is-active");
      const it = items[i];
      donutCenter(
        it.name,
        compact(it.value, isQty) + (it.unit ? ` ${it.unit}` : ""),
        pct(it.value, total),
      );
    };
    // Click (or tap / Enter) pins an item so its summary stays; hovering others previews them,
    // leaving returns to the pinned one. Click it again or press Esc to unpin.
    const markPinned = () =>
      el("donut-legend")
        .querySelectorAll("li")
        .forEach((li, n) => {
          li.classList.toggle("is-pinned", n === pinned);
          li.setAttribute("aria-pressed", String(n === pinned));
        });
    const togglePin = (i, touch = false) => {
      pinned = pinned === i ? null : i;
      // Remember by view + name so the 60-second auto refresh keeps the same item pinned.
      pinnedKey = pinned == null ? null : `${d.mode}|${items[pinned].name}`;
      markPinned();
      activate(pinned ?? (touch ? null : i));
    };
    markPinned();
    for (const node of [...g.querySelectorAll(".donut-slice"), ...el("donut-legend").children]) {
      const i = Number(node.dataset.index);
      node.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") activate(i);
      });
      node.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") activate(pinned);
      });
      node.addEventListener("focus", () => activate(i));
      node.addEventListener("blur", () => activate(pinned));
      node.addEventListener("click", (e) => togglePin(i, e.pointerType === "touch"));
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          togglePin(i);
        } else if (e.key === "Escape" && pinned != null) togglePin(pinned);
      });
    }
    if (!d.rows.length) {
      donutCenter("", "ไม่มีข้อมูล", "ในช่วงที่เลือก");
      return;
    }
    const paint = (p) => {
      const sweep = p * C;
      for (const s of donutSlices) {
        const vis = Math.max(0, Math.min(s.len, sweep - s.start));
        s.el.setAttribute("stroke-dasharray", `${vis} ${C}`);
      }
    };
    if (!animate || reduceMotion()) {
      paint(1);
      activate(pinned);
      return;
    }
    const began = performance.now(),
      duration = 1100,
      ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = (now) => {
      const t = Math.min(1, (now - began) / duration),
        p = ease(t);
      paint(p);
      if (!el("analysis-donut").dataset.active)
        donutCenter(totalLabel, totalText(total * p), totalSub);
      if (t < 1) donutFrame = requestAnimationFrame(frame);
      else if (!el("analysis-donut").dataset.active) activate(pinned);
    };
    paint(0);
    donutFrame = requestAnimationFrame(frame);
  }

  function clear() {
    chart?.destroy();
    chart = null;
    data = null;
    clearDonut();
    el("analysis-rows").replaceChildren();
    el("analysis-note").textContent = "";
  }
  function draw(d, animate = false) {
    const theme = window.dashboardTheme?.palette() || {
      muted: "#656973",
      line: "#e0e2e6",
      brand: "#e10600",
      surface: "#fff",
    };
    chart?.destroy();
    chart = null;
    const timeline = d.mode === "net";
    el("analysis-title").textContent = d.title;
    el("analysis-note").textContent = d.note;
    el("analysis-status").textContent =
      `${d.start} ถึง ${d.end} · อัปเดต ${new Date(d.updatedAt).toLocaleTimeString("th-TH")}`;
    document.querySelector(".analysis-scroll").hidden = !timeline;
    el("analysis-donut").hidden = timeline;
    if (!timeline) drawDonut(d, animate);
    else {
      clearDonut();
      el("analysis-plot").style.height = "280px";
      const labels = d.rows.map((r) => r.name);
      chart = new Chart(el("analysis-chart"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: d.rows.map((r) => r.value),
              borderColor: theme.brand,
              backgroundColor: "rgba(225, 6, 0,0.08)",
              borderWidth: 2.5,
              pointRadius: 3,
              pointBackgroundColor: "#fff",
              pointBorderColor: theme.brand,
              pointBorderWidth: 2,
              pointHoverRadius: 6,
              pointHoverBackgroundColor: theme.brand,
              pointHoverBorderColor: "#fff",
              pointHoverBorderWidth: 3,
              tension: 0,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          layout: { padding: { top: 4, right: 4, left: 4 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#482629",
              titleColor: "#f5dcd7",
              bodyColor: "#fff",
              padding: { top: 10, bottom: 10, left: 14, right: 14 },
              cornerRadius: 10,
              displayColors: false,
              titleFont: { size: 11, weight: "500" },
              bodyFont: { size: 13, weight: "600" },
              callbacks: {
                title: (items) => labels[items[0].dataIndex],
                label: (ctx) => `฿${format.format(ctx.parsed.y)}`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                maxTicksLimit: 6,
                maxRotation: 0,
                font: { size: 10, weight: "500" },
                color: theme.muted,
                padding: 6,
              },
            },
            y: {
              beginAtZero: true,
              border: { display: false },
              grid: { color: theme.line, lineWidth: 1 },
              ticks: {
                font: { size: 10, weight: "500" },
                color: theme.muted,
                padding: 8,
              },
            },
          },
        },
      });
      el("analysis-chart").setAttribute("aria-label", d.title);
    }
    el("analysis-rows").replaceChildren();
    for (const row of d.rows) {
      const tr = document.createElement("tr");
      const valueText = safeNumber(row.value);
      const unitText = safeText(row.unit ?? "บาท");
      for (const text of [label({ ...row, unit: "" }), valueText, unitText]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      el("analysis-rows").append(tr);
    }
  }
  async function load(silent = false) {
    silent = silent === true;
    if (!period) return;
    const id = ++version;
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    if (!silent) clear();
    const mode = el("analysis-mode").value,
      grain = el("analysis-grain").value;
    el("analysis-grain").hidden = mode !== "net";
    el("analysis-status").classList.remove("error");
    if (!silent) el("analysis-status").textContent = "กำลังโหลดข้อมูลกราฟ…";
    const timer = setTimeout(() => active.abort(), 20000);
    try {
      const response = await fetch(
        "/api/analytics?" + new URLSearchParams({ ...period, mode, grain }),
        { cache: "no-store", signal: active.signal },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (id !== version) return;
      data = result;
      draw(result, !silent);
    } catch (e) {
      if (id !== version) return;
      if (!silent) clear();
      el("analysis-status").textContent =
        e.name === "AbortError"
          ? "การโหลดใช้เวลานานเกินไป กรุณาลองใหม่"
          : e.message;
      el("analysis-status").classList.add("error");
    } finally {
      clearTimeout(timer);
    }
  }
  window.loadSalesAnalysis = (start, end, silent = false) => {
    period = { start, end };
    load(silent);
  };
  window.clearSalesAnalysis = () => {
    ++version;
    controller?.abort();
    period = null;
    clear();
    el("analysis-status").textContent = "รอข้อมูลช่วงวันที่";
  };
  el("analysis-mode").addEventListener("change", load);
  el("analysis-grain").addEventListener("change", load);
})();
