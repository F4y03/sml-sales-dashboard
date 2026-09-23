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
      "#a8000a",
      "#d90a0a",
      "#ff3b30",
      "#c62a2f",
      "#ee6a6a",
      "#8a1119",
      "#9a9ca5",
      "#c6c8ce",
      "#70737c",
      "#c04a4f",
    ],
    OTHER_COLOR = "#55575f",
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
    donutSlices = [];
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
  function clearDonut() {
    cancelAnimationFrame(donutFrame);
    donutSlices = [];
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
    const activate = (i) => {
      const box = el("analysis-donut");
      box.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));
      if (i == null || !items[i]) {
        box.removeAttribute("data-active");
        donutCenter(totalLabel, totalText(total), totalSub);
        return;
      }
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
    for (const node of [...g.querySelectorAll(".donut-slice"), ...el("donut-legend").children]) {
      const i = Number(node.dataset.index);
      node.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") activate(i);
      });
      node.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "touch") activate(null);
      });
      node.addEventListener("focus", () => activate(i));
      node.addEventListener("blur", () => activate(null));
      node.addEventListener("pointerup", (e) => {
        if (e.pointerType === "touch")
          activate(el("analysis-donut").dataset.active === String(i) ? null : i);
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
      activate(null);
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
      else if (!el("analysis-donut").dataset.active) activate(null);
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
    el("analysis-export").disabled = true;
    el("analysis-summary").textContent = "";
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
    el("analysis-summary").textContent = d.rows.length
      ? timeline
        ? `ทั้งหมด ${d.rows.length} ช่วงเวลา`
        : `แสดง ${Math.min(10, d.rows.length)} อันดับแรก จาก ${d.rows.length} รายการ`
      : "ไม่พบข้อมูลในช่วงที่เลือก";
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
    el("analysis-export").disabled = false;
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
  el("analysis-export").addEventListener("click", () => {
    if (!data) return;
    const rows = [
      [data.title],
      ["ช่วงวันที่", data.start, data.end],
      [data.note],
      ["รหัส", "ชื่อ", "ยอด / จำนวน", "หน่วย"],
      ...data.rows.map((r) => [r.code, r.name, r.value, r.unit || "บาท"]),
    ];
    const csv =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                String(v ?? "")
                  .replace(/^[\s]*[=+@\-]/, (m) => "'" + m)
                  .replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `sales-${data.mode}-${data.start}-${data.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
