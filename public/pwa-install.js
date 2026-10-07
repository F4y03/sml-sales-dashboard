// Install-as-app button: native prompt on Chrome/Edge/Android, manual Share → Add to Home Screen guide on iOS.
(() => {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferred = null;

  const style = document.createElement("style");
  style.textContent = `
    .pwa-install-btn{display:flex;align-items:center;gap:8px;width:100%;margin-top:12px;padding:10px 12px;border:1px dashed currentColor;border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:.9rem;cursor:pointer;opacity:.85}
    .pwa-install-btn:hover{opacity:1}
    .pwa-install-btn[hidden]{display:none}
    .pwa-ios-guide{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:16px;background:rgba(0,0,0,.5)}
    .pwa-ios-guide>div{max-width:420px;width:100%;padding:20px;border-radius:16px;background:#fff;color:#111;font-size:.95rem;line-height:1.6}
    .pwa-ios-guide ol{margin:8px 0 16px;padding-left:20px}
    .pwa-ios-guide button{width:100%;padding:10px;border:0;border-radius:10px;background:#e11d2a !important;color:#fff !important;font:inherit;cursor:pointer}`;
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pwa-install-btn";
  button.innerHTML = '<span aria-hidden="true">📲</span><span>ติดตั้งแอป</span>';

  const showGuide = (title, steps) => {
    const guide = document.createElement("div");
    guide.className = "pwa-ios-guide";
    guide.setAttribute("role", "dialog");
    guide.setAttribute("aria-modal", "true");
    guide.innerHTML = `<div><strong>${title}</strong><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      <button type="button">เข้าใจแล้ว</button></div>`;
    const close = () => guide.remove();
    guide.addEventListener("click", (e) => { if (e.target === guide || e.target.tagName === "BUTTON") close(); });
    document.body.append(guide);
    guide.querySelector("button").focus();
  };

  button.addEventListener("click", async () => {
    if (ios) return showGuide("ติดตั้งแอปบน iPhone / iPad", ["เปิดหน้านี้ด้วย <b>Safari</b>", "กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น)", "เลือก <b>“เพิ่มลงในหน้าจอโฮม”</b> แล้วกด <b>เพิ่ม</b>"]);
    if (!deferred) return showGuide("ติดตั้งแอป", ["ใช้ <b>Chrome</b> หรือ <b>Edge</b>", "กดไอคอนติดตั้งท้ายช่อง URL หรือเมนู <b>⋮</b>", "เลือก <b>“ติดตั้งแอป”</b>"]);
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
  });

  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
  });
  addEventListener("appinstalled", () => button.remove());

  const mount = () => {
    const nav = document.getElementById("workspace-links");
    if (nav) return nav.append(button);
    const loginFooter = document.querySelector(".lg-side > footer");
    if (loginFooter) loginFooter.before(button);
  };
  // Wait for load: workspace-nav.js builds the sidebar after this deferred script runs.
  if (document.readyState === "complete") mount();
  else addEventListener("load", mount);
})();
