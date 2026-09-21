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
function regionMap(name) {
  const map = document.createElement("span");
  map.className = "territory-map-preview " + regionKey(name);
  map.setAttribute("aria-hidden", "true");
  return map;
}
try {
  const response = await fetch("/api/auth/me");
  if (!response.ok) throw new Error("โหลดบัญชีไม่สำเร็จ");
  const user = await response.json();
  if (user.scope !== "territory") location.replace(user.landing);
  status.textContent = user.territories.length
    ? "เลือกเขตเพื่อเริ่มใช้งาน"
    : "ยังไม่ได้รับการกำหนดเขตการขาย กรุณาติดต่อผู้ดูแลระบบ";
  if (user.supportMessage) {
    const p = document.createElement("p");
    p.textContent = user.supportMessage;
    status.after(p);
  }
  for (const t of user.territories) {
    const b = document.createElement("button"),
      content = document.createElement("span"),
      title = document.createElement("strong"),
      hint = document.createElement("small");
    b.type = "button";
    b.className = "territory-choice";
    title.textContent = t.name;
    hint.textContent = "กดเพื่อดูข้อมูลเขตนี้";
    content.className = "territory-choice-copy";
    content.append(title, hint);
    b.append(regionMap(t.name), content);
    b.onclick = async () => {
      for (const x of choices.children) x.disabled = true;
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
        status.textContent = e.message;
        for (const x of choices.children) x.disabled = false;
      }
    };
    choices.append(b);
  }
} catch (e) {
  status.textContent = e.message;
}
