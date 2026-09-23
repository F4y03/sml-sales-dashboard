// The brand PNG is baked as a red mark + black caption on an opaque white
// background — fine on the light card, illegible on the dark one. Instead of
// a flat invert filter (which also dulled the red), recolor it once on a
// canvas: drop the white background to transparent and flip only the
// near-black/grayscale caption pixels to white, leaving the logo's own red
// untouched. theme-mode.js runs before this (non-deferred script, loaded
// earlier in <head>), so data-theme is already set by the time this runs.
(() => {
  const brandImg = document.querySelector(".lg-logo img");
  if (!brandImg) return;
  const brandLogoSrc = { light: brandImg.src, dark: null };
  function recolorForDark(sourceSrc) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        let frame;
        try {
          frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch {
          resolve(null);
          return;
        }
        const data = frame.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          const max = Math.max(r, g, b),
            min = Math.min(r, g, b);
          if (max - min >= 18) continue; // colored (the logo's red) — leave as-is
          if (max > 235) data[i + 3] = 0; // white background -> transparent
          else if (max < 140) {
            data[i] = data[i + 1] = data[i + 2] = 255; // black caption -> white
          }
        }
        ctx.putImageData(frame, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => resolve(null);
      image.src = sourceSrc;
    });
  }
  async function applyBrandLogoTheme() {
    const dark = document.documentElement.dataset.theme !== "light";
    if (!dark) {
      brandImg.src = brandLogoSrc.light;
      return;
    }
    if (!brandLogoSrc.dark)
      brandLogoSrc.dark = await recolorForDark(brandLogoSrc.light);
    brandImg.src = brandLogoSrc.dark || brandLogoSrc.light;
  }
  applyBrandLogoTheme();
  window.addEventListener("dashboard-theme-change", applyBrandLogoTheme);
})();

const form = document.querySelector("#login-form");
const password = document.querySelector("#password");
const toggle = document.querySelector("#toggle-password");
document.querySelector("#year").textContent = new Date().getFullYear();
toggle.addEventListener("click", () => {
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  toggle.textContent = show ? "ซ่อน" : "แสดง";
  toggle.setAttribute("aria-label", show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
  toggle.setAttribute("aria-pressed", String(show));
});
const twofaForm = document.querySelector("#twofa-form");
const recoveryPanel = document.querySelector("#recovery-panel");
const card = document.querySelector("#lg-card");
let challenge = "";
function navigateTo(data) {
  const next = new URLSearchParams(location.search).get("next");
  const target = new URL(
    data.redirect || next || "/executive.html",
    location.origin,
  );
  location.replace(
    target.origin === location.origin &&
      !target.pathname.startsWith("/login") &&
      !target.pathname.startsWith("/api/")
      ? target.href
      : "/executive.html",
  );
}
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const loadingScreen = document.querySelector("#lg-loading");
const loadingBar = document.querySelector("#lg-loading-bar");
const loadingPct = document.querySelector("#lg-loading-pct");
// Runs the "PREPARING WORKSPACE..." transition before the real navigation.
// Purely cosmetic: the login already succeeded, this just paces the handoff
// to the dashboard so it doesn't feel like an abrupt jump-cut.
function proceed(data) {
  if (reduceMotion) return navigateTo(data);
  card.classList.add("lg-card-exit");
  loadingScreen.hidden = false;
  requestAnimationFrame(() => loadingScreen.classList.add("is-visible"));
  const duration = 2600;
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const percent = Math.round(eased * 100);
    loadingBar.style.width = percent + "%";
    loadingPct.textContent = percent + "%";
    if (progress < 1) {
      requestAnimationFrame(tick);
      return;
    }
    setTimeout(() => {
      loadingScreen.classList.add("is-leaving");
      setTimeout(() => navigateTo(data), 420);
    }, 260);
  }
  requestAnimationFrame(tick);
}
function showTwoFactor(step) {
  challenge = step.challenge;
  const setup = step.mode === "setup";
  card.dataset.step = setup ? "setup" : "verify";
  form.hidden = true;
  twofaForm.hidden = false;
  document.querySelector("#login-help").hidden = true;
  document.querySelector("#twofa-setup").hidden = !setup;
  document.querySelector("#twofa-hint").hidden = setup;
  document.querySelector("#twofa-intro").textContent = setup
    ? "ทุกบัญชีต้องเปิดใช้การยืนยันตัวตน 2 ขั้นตอน ตั้งค่าแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน"
    : "กรอกรหัส 6 หลักจากแอป Authenticator เพื่อเข้าสู่ระบบ";
  if (setup) {
    document.querySelector("#twofa-qr").src = step.qr;
    document.querySelector("#twofa-secret").textContent = step.secret;
  }
  document.querySelector("#twofa-trust-days").textContent = step.trustDays ?? 15;
  document.querySelector("#otp").focus();
}
document.querySelector("#twofa-back").addEventListener("click", () => {
  challenge = "";
  card.dataset.step = "login";
  twofaForm.reset();
  twofaForm.hidden = true;
  document.querySelector("#twofa-error").textContent = "";
  document.querySelector("#twofa-qr").removeAttribute("src");
  document.querySelector("#twofa-secret").textContent = "";
  document.querySelector("#login-help").hidden = false;
  password.value = "";
  form.hidden = false;
  password.focus();
});
twofaForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#twofa-submit");
  const error = document.querySelector("#twofa-error");
  button.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch("/api/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
      body: JSON.stringify({
        challenge,
        code: document.querySelector("#otp").value.trim(),
        trust: document.querySelector("#twofa-trust").checked,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.code === "CHALLENGE_EXPIRED") {
        document.querySelector("#twofa-back").click();
        document.querySelector("#login-error").textContent = data.error;
        return;
      }
      throw new Error(data.error || "ยืนยันไม่สำเร็จ กรุณาลองใหม่");
    }
    if (data.recoveryCodes) {
      card.dataset.step = "recovery";
      twofaForm.hidden = true;
      recoveryPanel.hidden = false;
      document.querySelector("#twofa-setup").hidden = true;
      document.querySelector("#recovery-codes").textContent =
        data.recoveryCodes.join("\n");
      document.querySelector("#recovery-done").onclick = () => {
        downloadRecoveryCodes(data.recoveryCodes);
        proceed(data);
      };
      return;
    }
    proceed(data);
  } catch (e) {
    error.textContent =
      e.message === "Failed to fetch"
        ? "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
        : e.message;
    document.querySelector("#otp").select();
  } finally {
    button.disabled = false;
  }
});
function downloadRecoveryCodes(codes) {
  const blob = new Blob(
    [
      "PRO PLUS Recovery Codes\n" +
        "เก็บไว้ในที่ปลอดภัย ใช้ได้รหัสละ 1 ครั้งเมื่อไม่มีโทรศัพท์\n\n" +
        codes.join("\n") +
        "\n\n" +
        "วิธีใช้:\n" +
        "1. เข้าหน้า Login กรอก Username และรหัสผ่านตามปกติ\n" +
        "2. เมื่อถึงหน้า \"ยืนยันตัวตน\" ให้กดที่ช่องกรอกรหัส 6 หลัก\n" +
        "3. พิมพ์รหัสจากไฟล์นี้ 1 ชุด (รูปแบบ XXXX-XXXX-XXXX) แทนรหัส 6 หลักจากแอป Authenticator แล้วกดยืนยัน\n" +
        "4. รหัสที่ใช้แล้วจะหมดอายุทันที ใช้ซ้ำไม่ได้ ให้ใช้รหัสถัดไปในครั้งหน้า\n" +
        "5. ถ้ารหัสในไฟล์นี้ใช้หมดหรือทำหาย ให้ติดต่อ Super Admin เพื่อรีเซ็ต 2FA ใหม่\n",
    ],
    { type: "text/plain" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "prplus-recovery-codes.txt";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
document
  .querySelector("#recovery-copy")
  .addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText(
        document.querySelector("#recovery-codes").textContent,
      );
      event.target.textContent = "คัดลอกแล้ว";
    } catch {
      event.target.textContent = "คัดลอกไม่ได้ กรุณาจดด้วยตนเอง";
    }
  });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#submit");
  const error = document.querySelector("#login-error");
  button.disabled = true;
  button.firstElementChild.textContent = "กำลังเข้าสู่ระบบ…";
  error.textContent = "";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
      body: JSON.stringify({
        username: form.username.value.trim(),
        password: password.value,
      }),
    });
    if (response.status === 404)
      throw new Error(
        "เซิร์ฟเวอร์ยังไม่โหลดระบบล็อกอิน กรุณาให้ผู้ดูแลรีสตาร์ตเซิร์ฟเวอร์",
      );
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ");
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่");
    if (data.twoFactor) return showTwoFactor(data.twoFactor);
    proceed(data);
  } catch (error) {
    document.querySelector("#login-error").textContent =
      error.message === "Failed to fetch"
        ? "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
        : error.message;
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = "เข้าสู่ระบบ";
  }
});
