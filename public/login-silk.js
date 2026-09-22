(() => {
  const canvas = document.getElementById("lg-silk");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let width = 0,
    height = 0,
    dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, width, height);
  }
  resize();
  window.addEventListener("resize", resize);

  // Each strand is a slow sine wave with its own phase, amplitude and speed
  // so the set drifts like overlapping silk ribbons rather than a single wave.
  const strands = Array.from({ length: 6 }, (_, i) => ({
    baseY: 0.2 + (i / 5) * 0.6,
    amplitude: 40 + i * 14,
    frequency: 0.9 + i * 0.15,
    speed: 0.00012 + i * 0.00003,
    phase: i * 1.7,
    width: 1.4 + (i % 3) * 0.8,
    alpha: 0.22 + (i % 3) * 0.08,
  }));

  function drawStrand(strand, t) {
    ctx.beginPath();
    const centerY = strand.baseY * height;
    const step = Math.max(4, width / 220);
    for (let x = 0; x <= width + step; x += step) {
      const progress = x / width;
      const y =
        centerY +
        Math.sin(progress * Math.PI * strand.frequency + t * strand.speed + strand.phase) *
          strand.amplitude +
        Math.sin(progress * Math.PI * 2.3 + t * strand.speed * 1.7) * (strand.amplitude * 0.25);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(229, 29, 32, ${strand.alpha})`;
    ctx.lineWidth = strand.width;
    ctx.stroke();
  }

  let raf = null;
  function frame(t) {
    // Fade the previous frame toward black instead of clearing, so trails
    // smooth out and overlaps (drawn with 'lighter') stay bright.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(5, 5, 5, 0.12)";
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (const strand of strands) drawStrand(strand, t);
    ctx.globalCompositeOperation = "source-over";

    raf = requestAnimationFrame(frame);
  }

  if (reduceMotion) {
    // Draw one static composition instead of animating continuously.
    ctx.globalCompositeOperation = "lighter";
    for (const strand of strands) drawStrand(strand, 0);
    ctx.globalCompositeOperation = "source-over";
    return;
  }

  raf = requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = null;
    } else if (!raf) {
      raf = requestAnimationFrame(frame);
    }
  });
})();
