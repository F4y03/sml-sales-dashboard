import "./assets/chart.umd.js";
let chart,
  lastProducts = [],
  lastUnit = "",
  lastLoaded = false;
const fmt = (n) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(n);
export function renderRegionalChart(products, unit, loaded) {
  lastProducts = products;
  lastUnit = unit;
  lastLoaded = loaded;
  const groups = new Map();
  for (const p of products) {
    if (!groups.has(p.region)) groups.set(p.region, { out: 0, balance: 0 });
    const g = groups.get(p.region);
    g.out += p.out;
    g.balance += p.balance;
  }
  const entries = [...groups].sort((a, b) => b[1].out - a[1].out),
    units = new Set(products.map((p) => p.unit));
  const unitText =
    unit || (units.size === 1 ? [...units][0] : "รวมจำนวนต่างหน่วย");
  document.getElementById("regional-note").textContent = !loaded
    ? "กำลังรอข้อมูลจาก SML"
    : !products.length
      ? "ไม่พบข้อมูลที่ตรงตัวกรอง"
      : `หน่วย: ${unitText}` +
        (units.size > 1
          ? " · เลือกตัวกรองหน่วยด้านบนเพื่อเปรียบเทียบหน่วยเดียวกัน"
          : "");
  const tbody = document.getElementById("regional-values");
  tbody.replaceChildren();
  for (const [name, g] of entries) {
    const tr = document.createElement("tr");
    for (const value of [name, fmt(g.out), fmt(g.balance)]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
  const style = getComputedStyle(document.documentElement),
    color = style.getPropertyValue("--muted").trim(),
    grid = style.getPropertyValue("--line").trim();
  const data = {
    labels: entries.map(([name]) => name),
    datasets: [
      {
        label: "เบิกออกสะสม",
        data: entries.map(([, g]) => g.out),
        backgroundColor: "#ed382e",
        borderRadius: 4,
      },
      {
        label: "คงเหลือล่าสุด",
        data: entries.map(([, g]) => g.balance),
        backgroundColor: "#36a7b4",
        borderRadius: 4,
      },
    ],
  };
  const options = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { position: "bottom", labels: { color, boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: (c) => `${c.dataset.label}: ${fmt(c.parsed.x)} (${unitText})`,
        },
      },
    },
    scales: {
      x: { beginAtZero: true, ticks: { color }, grid: { color: grid } },
      y: { ticks: { color }, grid: { display: false } },
    },
  };
  if (chart) {
    chart.data = data;
    chart.options = options;
    chart.update();
  } else
    chart = new Chart(document.getElementById("regional-chart"), {
      type: "bar",
      data,
      options,
    });
}
window.addEventListener("dashboard-theme-change", () =>
  renderRegionalChart(lastProducts, lastUnit, lastLoaded),
);
