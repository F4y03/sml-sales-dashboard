// หน้าโหลดแคตตาล็อก: overlay on #ecat-stage while catalog.js loads a PDF.
// API (window.ecatLoader): start(title) -> session; session.progress(0..1), .prepared(numPages), .done(), .fail(message), .cancel().
// Progress is real: 0–70% download (pdf.js onProgress), 80% file parsed, 100% cover rendered.
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const TIPS = [
    "เคล็ดลับ: กดรูปย่อด้านล่าง เพื่อกระโดดไปหน้านั้นทันที",
    "เคล็ดลับ: ใช้ปุ่มลูกศร ← / → บนคีย์บอร์ดเพื่อพลิกหน้า",
    "เคล็ดลับ: พิมพ์รุ่นสินค้าในช่องค้นหา เช่น MNX-800",
    "เคล็ดลับ: กด “แชร์หน้านี้” เพื่อคัดลอกหน้าเป็นรูปส่งให้ลูกค้า",
    "เคล็ดลับ: เลือกหมวดหมู่จากเมนูด้านบนเพื่อข้ามไปหมวดนั้น",
  ];
  const MIN_MS = 1400;
  let el = null, active = null;

  function build() {
    el = document.createElement("div");
    el.className = "ld";
    el.hidden = true;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `
      <canvas aria-hidden="true"></canvas>
      <div class="ld-box">
        <div class="ld-scene" aria-hidden="true">
          <span class="ld-glow"></span>
          <span class="ld-wave"></span><span class="ld-wave"></span><span class="ld-wave"></span>
          <div class="ld-book">
            <span class="ld-half l"></span><span class="ld-half r"></span>
            <span class="ld-page"></span><span class="ld-page"></span><span class="ld-page"></span>
          </div>
        </div>
        <p class="ld-kicker ld-type" data-text="PROPLUS · E-CATALOG"></p>
        <h3 class="ld-title ld-type"></h3>
        <p class="ld-status"><span class="ld-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="ld-status-text"></span></p>
        <div class="ld-bar" aria-hidden="true"><div class="ld-fill"></div><span class="ld-dot"></span></div>
        <div class="ld-meta"><span class="ld-sub"></span><b class="ld-pct">0%</b></div>
        <ol class="ld-steps"><li>ดาวน์โหลด</li><li>เตรียมหน้า</li><li>พร้อมอ่าน</li></ol>
        <p class="ld-help" hidden></p>
      </div>
      <p class="ld-tip"></p>`;
    return el;
  }
  const q = (s) => el.querySelector(s);

  function typeText(node, text) {
    node.replaceChildren();
    node.setAttribute("aria-label", text);
    [...text].forEach((ch, i) => {
      const span = document.createElement("span");
      span.textContent = ch;
      span.setAttribute("aria-hidden", "true");
      span.style.animationDelay = i * 35 + "ms";
      node.append(span);
    });
  }

  function start(stage, title) {
    active?.cancel();
    if (!el) stage.append(build());
    else if (el.parentNode !== stage) stage.append(el);
    const began = performance.now();
    let target = 0, shown = 0, raf = 0, tipTimer = 0, sparkRaf = 0, finished = false, alive = true;
    const book = q(".ld-book"), fill = q(".ld-fill"), dot = q(".ld-dot"), pct = q(".ld-pct");
    const steps = [...el.querySelectorAll(".ld-steps li")];
    el.hidden = false;
    el.classList.remove("is-out", "is-error");
    q(".ld-help").hidden = true;
    typeText(q(".ld-kicker"), "PROPLUS · E-CATALOG");
    typeText(q(".ld-title"), title || "แคตตาล็อก");
    setStatus("กำลังดาวน์โหลดแคตตาล็อก…", "หน้าปกและหน้าแรก");
    setStep(0);
    paint(0);

    function setStatus(text, sub) {
      q(".ld-status-text").textContent = text;
      if (sub != null) q(".ld-sub").textContent = sub;
    }
    function setStep(n) {
      steps.forEach((li, i) => {
        li.classList.toggle("is-done", i < n || (n === 3));
        li.classList.toggle("is-active", i === n && n < 3);
      });
    }
    function paint(v) {
      const p = Math.round(v * 100);
      fill.style.width = p + "%";
      dot.style.left = p + "%";
      pct.textContent = p + "%";
    }
    // Smooth count-up toward the real target (never jumps, never passes it).
    function tick() {
      if (!alive) return;
      shown += (target - shown) * (reduced.matches ? 1 : 0.08);
      if (target - shown < 0.002) shown = target;
      paint(shown);
      if (shown < target) raf = requestAnimationFrame(tick);
      else raf = 0;
    }
    function to(v) {
      target = Math.max(target, Math.min(1, v));
      if (!raf) raf = requestAnimationFrame(tick);
    }

    // Tips rotate every 3.2s with a fade.
    const tip = q(".ld-tip");
    let tipAt = Math.floor(Math.random() * TIPS.length);
    tip.textContent = TIPS[tipAt];
    tip.classList.remove("is-fading");
    if (!reduced.matches) {
      tipTimer = setInterval(() => {
        tip.classList.add("is-fading");
        setTimeout(() => {
          if (!alive) return;
          tipAt = (tipAt + 1) % TIPS.length;
          tip.textContent = TIPS[tipAt];
          tip.classList.remove("is-fading");
        }, 400);
      }, 3200);
    }

    // Book tilts toward the mouse.
    const onMove = (event) => {
      if (reduced.matches) return;
      const r = el.getBoundingClientRect();
      const x = (event.clientX - r.left) / r.width - 0.5, y = (event.clientY - r.top) / r.height - 0.5;
      book.style.setProperty("--ld-ry", (x * 30 - 10).toFixed(1) + "deg");
      book.style.setProperty("--ld-rx", (8 - y * 20).toFixed(1) + "deg");
    };
    el.addEventListener("pointermove", onMove);

    // Small red sparks drifting up from the book (no burst at 100%).
    const canvas = q("canvas"), ctx = canvas.getContext("2d");
    const sparks = [];
    function sparkLoop() {
      if (!alive || el.hidden) return;
      const dpr = Math.min(2, devicePixelRatio || 1), w = el.clientWidth, h = el.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sr = q(".ld-scene").getBoundingClientRect(), er = el.getBoundingClientRect();
      const cx = sr.left - er.left + sr.width / 2, cy = sr.top - er.top + sr.height / 2;
      if (sparks.length < 40 && Math.random() < 0.35) {
        sparks.push({ x: cx + (Math.random() - 0.5) * 120, y: cy + 20, vx: (Math.random() - 0.5) * 0.3, vy: -0.4 - Math.random() * 0.7, life: 1, r: 0.8 + Math.random() * 1.6 });
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx; s.y += s.vy; s.life -= 0.008;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, ${60 + Math.round(60 * s.life)}, 70, ${(s.life * 0.8).toFixed(2)})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      sparkRaf = requestAnimationFrame(sparkLoop);
    }
    if (!reduced.matches) sparkRaf = requestAnimationFrame(sparkLoop);

    function stopAll() {
      alive = false;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(sparkRaf);
      clearInterval(tipTimer);
      el.removeEventListener("pointermove", onMove);
      sparks.length = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    function hide(fade) {
      stopAll();
      if (!fade || reduced.matches) { el.hidden = true; return; }
      el.classList.add("is-out");
      setTimeout(() => { if (active === session || !active) { if (el.classList.contains("is-out")) el.hidden = true; } }, 650);
    }

    const session = {
      progress(ratio) { if (!finished) to(ratio * 0.7); },
      prepared(pages) {
        if (finished) return;
        setStatus("กำลังเตรียมหน้าแคตตาล็อก…", pages ? `ทั้งหมด ${pages} หน้า` : null);
        setStep(1);
        to(0.8);
      },
      done() {
        if (finished) return;
        finished = true;
        setStatus("พร้อมอ่านแล้ว", "เปิดหน้าปก");
        setStep(3);
        to(1);
        const wait = Math.max(0, MIN_MS - (performance.now() - began)) + (reduced.matches ? 0 : 450);
        setTimeout(() => { if (active === session) { active = null; hide(true); } }, wait);
      },
      fail(message) {
        if (finished) return;
        finished = true;
        el.classList.add("is-error");
        setStatus("เปิดไฟล์ไม่สำเร็จ");
        const help = q(".ld-help");
        help.textContent = message || "ตรวจการเชื่อมต่อแล้วลองใหม่";
        help.hidden = false;
        steps.forEach((li) => li.classList.remove("is-active"));
        // Hand over to the page's own error panel (with "ลองอีกครั้ง") after a short moment.
        setTimeout(() => { if (active === session) { active = null; hide(true); } }, 1800);
      },
      cancel() { finished = true; if (active === session) active = null; hide(false); },
    };
    active = session;
    return session;
  }

  window.ecatLoader = { start: (title) => start(document.getElementById("ecat-stage"), title) };
})();
