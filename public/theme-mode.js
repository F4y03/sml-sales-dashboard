(() => {
  const key = "prplus-theme";
  const root = document.documentElement;
  let preference;
  try {
    preference = localStorage.getItem(key);
  } catch {}
  root.dataset.theme = preference === "light" ? "light" : "dark";
  // Match the sidebar's red mark and white caption on a transparent background.
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    const logo = new Image();
    logo.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = logo.naturalWidth;
        canvas.height = logo.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(logo, 0, 0);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < frame.data.length; i += 4) {
          const max = Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
          const min = Math.min(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
          if (max - min >= 18) continue; // Preserve the existing red mark.
          frame.data[i + 3] *= (255 - max) / 255;
          frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = 255;
        }
        ctx.putImageData(frame, 0, 0);
        favicon.href = canvas.toDataURL("image/png");
      } catch {
        // Retain the original icon if canvas rendering is unavailable.
      }
    };
    logo.src = favicon.href;
  }
  const palette = () => {
    const style = getComputedStyle(root);
    return Object.fromEntries(
      ["ink", "muted", "line", "surface", "brand"].map((name) => [
        name,
        style.getPropertyValue(`--${name}`).trim(),
      ]),
    );
  };
  function setMode(mode, persist = true) {
    root.dataset.theme = mode === "light" ? "light" : "dark";
    if (persist)
      try {
        localStorage.setItem(key, root.dataset.theme);
      } catch {}
    document
      .querySelectorAll("[data-theme-mode]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.themeMode === root.dataset.theme),
        ),
      );
    window.dispatchEvent(new Event("dashboard-theme-change"));
  }
  window.dashboardTheme = { palette, setMode };
  window.addEventListener("storage", (event) => {
    if (event.key === key) setMode(event.newValue, false);
  });
  document.addEventListener("DOMContentLoaded", () => {
    const control = document.createElement("div");
    control.className = "theme-switch";
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", "โหมดการแสดงผล");
    for (const [mode, label, icon] of [
      ["light", "สว่าง", "☀"],
      ["dark", "มืด", "☾"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.themeMode = mode;
      const symbol = document.createElement("span");
      symbol.textContent = icon;
      symbol.setAttribute("aria-hidden", "true");
      button.append(symbol, ` ${label}`);
      button.setAttribute("aria-pressed", String(root.dataset.theme === mode));
      button.addEventListener("click", () => setMode(mode));
      control.append(button);
    }
    const sidebar = document.querySelector(".workspace-sidebar");
    const topbar = document.querySelector(".lg-topbar");
    if (sidebar) sidebar.querySelector(".workspace-links").before(control);
    else if (topbar) topbar.prepend(control);
    else document.querySelector(".form-panel")?.prepend(control);
  });
})();
