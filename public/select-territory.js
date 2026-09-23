const status = document.getElementById("territory-status"),
  choices = document.getElementById("territory-choices");
function regionKey(name) {
  const value = String(name || "");
  if (value.includes("ตะวันออกเฉียงเหนือ") || value.includes("อีสาน"))
    return "northeast";
  if (value.includes("ตะวันออก")) return "east";
  if (value.includes("เหนือ")) return "north";
  if (value.includes("ใต้")) return "south";
  if (value.includes("กลาง")) return "central";
  return "all";
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function showStatus(text, isError = false) {
  status.textContent = text;
  status.dataset.error = String(isError);
}
function finishLoading() {
  choices.replaceChildren();
  choices.removeAttribute("aria-busy");
}
function card(t, index, current) {
  const key = regionKey(t.name),
    b = el("button", `territory-choice region-${key}`),
    mapWrap = el("span", "territory-map-wrap"),
    map = el("span", `territory-map-preview ${key}`),
    copy = el("span", "territory-choice-copy"),
    hint = el("span", "territory-desc", "ดูยอดขาย ลูกค้า และสินค้าฝากของเขตนี้"),
    go = el("span", "territory-go", "→");
  b.type = "button";
  b.style.setProperty("--i", index);
  b.setAttribute("aria-label", t.name);
  hint.id = `territory-desc-${index}`;
  b.setAttribute("aria-describedby", hint.id);
  map.setAttribute("aria-hidden", "true");
  go.setAttribute("aria-hidden", "true");
  mapWrap.append(map);
  const meta = el("span", "territory-meta");
  if (t.code) meta.append(el("small", "territory-code", t.code));
  if (current) {
    meta.append(el("small", "territory-current", "เขตปัจจุบัน"));
    b.setAttribute("aria-current", "true");
  }
  copy.append(meta, el("strong", undefined, t.name), hint);
  b.append(mapWrap, copy, go);
  b.onclick = async () => {
    for (const x of choices.children) x.disabled = true;
    b.dataset.loading = "true";
    hint.textContent = "กำลังเปิดเขตนี้…";
    try {
      const r = await fetch("/api/auth/territory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PRPlus-Request": "1",
        },
        body: JSON.stringify({ territoryId: t.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      location.replace(data.redirect);
    } catch (e) {
      showStatus(e.message || "เปลี่ยนเขตไม่สำเร็จ กรุณาลองใหม่", true);
      delete b.dataset.loading;
      hint.textContent = "ดูยอดขาย ลูกค้า และสินค้าฝากของเขตนี้";
      for (const x of choices.children) x.disabled = false;
    }
  };
  return b;
}
try {
  const response = await fetch("/api/auth/me");
  if (!response.ok) throw new Error("โหลดบัญชีไม่สำเร็จ");
  const user = await response.json();
  if (user.scope !== "territory") location.replace(user.landing);
  finishLoading();
  if (!user.territories.length) {
    showStatus("ยังไม่ได้รับการกำหนดเขตการขาย");
    const empty = el("div", "territory-empty");
    empty.append(
      el("strong", undefined, "ยังไม่มีเขตที่ได้รับมอบหมาย"),
      el("p", undefined, "กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดเขตการขายให้บัญชีนี้"),
    );
    choices.append(empty);
  } else {
    showStatus(
      `ได้รับมอบหมาย ${user.territories.length} เขต · เลือก 1 เขตเพื่อเริ่มใช้งาน`,
    );
    user.territories.forEach((t, i) =>
      choices.append(card(t, i, Number(t.id) === Number(user.territoryId))),
    );
  }
  if (user.supportMessage) {
    const p = el("p", "territory-support", user.supportMessage);
    status.after(p);
  }
} catch (e) {
  finishLoading();
  showStatus(e.message, true);
}
