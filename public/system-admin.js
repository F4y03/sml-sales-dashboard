const content = document.getElementById("admin-content"),
  status = document.getElementById("admin-status"),
  tabs = document.getElementById("admin-tabs");
let me,
  catalog,
  current = "users",
  auditPage = 0,
  auditCursors = [null];
const has = (p) => me.role === "super_admin" || me.permissions.includes(p);
const node = (tag, value, cls) => {
  const n = document.createElement(tag);
  if (value !== undefined) n.textContent = value;
  if (cls) n.className = cls;
  return n;
};
const button = (title, click, cls) => {
  const b = node("button", title, cls);
  b.type = "button";
  b.onclick = click;
  return b;
};
const message = (text, error = false) => {
  status.textContent = text;
  status.dataset.error = String(error);
};
async function api(path, method = "GET", body) {
  const r = await fetch("/api/admin/" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-PRPlus-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "ดำเนินการไม่สำเร็จ");
  return data;
}
const card = (title) => {
  const c = node("section", undefined, "admin-card");
  if (title) c.append(node("h2", title));
  content.append(c);
  return c;
};
function field(parent, label, name, value = "", type = "text") {
  const l = node("label", label),
    input = node(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  input.name = name;
  input.value = value;
  input.autocomplete = type === "password" ? "new-password" : "off";
  if (type !== "password") input.maxLength = 200;
  l.append(input);
  parent.append(l);
  return input;
}
function select(parent, label, name, items, value) {
  const l = node("label", label),
    s = node("select");
  s.name = name;
  for (const item of items) {
    const o = node("option", item.name);
    o.value = item.code;
    s.append(o);
  }
  s.value = value;
  l.append(s);
  parent.append(l);
  return s;
}
// Switch-style row: title + hint on the left, toggle on the right. Returns the underlying checkbox.
function toggle(parent, title, hint, name, checked) {
  const l = node("label", undefined, "toggle-card"),
    i = node("input"),
    text = node("span", undefined, "toggle-text");
  i.type = "checkbox";
  i.name = name;
  i.checked = checked;
  i.setAttribute("role", "switch");
  text.append(node("strong", title), node("small", hint));
  l.append(text, i, node("span", undefined, "toggle-track"));
  parent.append(l);
  return i;
}
function check(parent, label, name, value, checked) {
  const l = node("label", undefined, "check"),
    i = node("input");
  i.type = "checkbox";
  i.name = name;
  i.value = value;
  i.checked = checked;
  l.append(i, document.createTextNode(label));
  parent.append(l);
  return i;
}
function table(parent, headers, rows) {
  const wrap = node("div", undefined, "table-scroll"),
    t = node("table"),
    head = node("thead"),
    tr = node("tr");
  headers.forEach((h) => tr.append(node("th", h)));
  head.append(tr);
  t.append(head);
  const body = node("tbody");
  for (const row of rows) {
    const tr = node("tr");
    for (const item of row) {
      const td = node("td");
      if (item instanceof Node) td.append(item);
      else td.textContent = item;
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(body);
  wrap.append(t);
  parent.append(wrap);
  if (!rows.length) parent.append(node("p", "ยังไม่มีรายการ", "muted"));
}
function submit(form, label, fn) {
  const actions = node("div", undefined, "actions"),
    b = node("button", label, "primary"),
    feedback = node("p", undefined, "admin-form-status");
  b.type = "submit";
  feedback.setAttribute("role", "alert");
  feedback.setAttribute("aria-live", "assertive");
  actions.append(b, feedback);
  form.append(actions);
  const clearError = () => {
    feedback.textContent = "";
    feedback.dataset.error = "false";
    for (const field of form.elements) field.removeAttribute?.("aria-invalid");
  };
  const errorField = (text) => {
    const rules = [
      ["Username", "username"],
      ["ชื่อ", "full_name"],
      ["รหัสผ่าน", "password"],
      ["Role", "role"],
      ["สถานะ", "is_active"],
      ["เขต", "territories"],
      ["Permission", "permissions"],
      ["สิทธิ์", "permissions"],
    ];
    const name = rules.find(([word]) => text.includes(word))?.[1];
    return name ? form.elements.namedItem(name) : null;
  };
  form.addEventListener("input", clearError);
  form.addEventListener(
    "invalid",
    (e) => {
      feedback.textContent = `กรุณาตรวจสอบช่อง ${e.target.closest("label")?.firstChild?.textContent?.trim() || e.target.name || "ที่กรอก"}`;
      feedback.dataset.error = "true";
    },
    true,
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    clearError();
    b.disabled = true;
    feedback.textContent = "กำลังบันทึก…";
    message("กำลังบันทึก…");
    try {
      await fn(new FormData(form));
      feedback.textContent = "บันทึกแล้ว";
      message("บันทึกแล้ว");
    } catch (error) {
      const detail = error.message || "ดำเนินการไม่สำเร็จ";
      feedback.textContent = "บันทึกไม่ได้: " + detail;
      feedback.dataset.error = "true";
      message(detail, true);
      const target = errorField(detail);
      if (target instanceof RadioNodeList) {
        target[0]?.setAttribute("aria-invalid", "true");
        target[0]?.focus();
      } else if (target) {
        target.setAttribute("aria-invalid", "true");
        target.focus();
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } finally {
      b.disabled = false;
    }
  };
  return actions;
}
function selected(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(
    (x) => x.value,
  );
}
async function refreshCatalog() {
  catalog = await api("catalog");
}

async function usersView() {
  const list = card("ผู้ใช้งาน"),
    { users } = await api("users"),
    toolbar = node("div", undefined, "users-toolbar"),
    summary = node(
      "p",
      `${users.length} บัญชี · เปิดใช้งาน ${users.filter((u) => u.is_active).length} บัญชี`,
      "users-summary",
    );
  toolbar.append(
    summary,
    button("+ เพิ่มผู้ใช้", () => editUser(), "primary"),
  );
  list.append(toolbar);
  table(
    list,
    ["ผู้ใช้งาน", "สิทธิ์", "สถานะ", "การจัดการ"],
    users.map((u) => {
      const person = node("div", undefined, "user-identity"),
        name = node("strong", u.full_name || u.username),
        username = node("span", "@" + u.username),
        role = node("span", u.role.replaceAll("_", " "), "role-chip"),
        state = node(
          "span",
          u.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน",
          u.is_active ? "user-status active" : "user-status inactive",
        ),
        actions = node("div", undefined, "user-row-actions");
      person.append(name, username);
      actions.append(button("แก้ไข", () => editUser(u), "action-edit"));
      if (u.twoFactorRequired && u.id !== me.id)
        actions.append(
          button(
            "รีเซ็ต 2FA",
            async () => {
              if (
                !confirm(
                  `รีเซ็ต 2FA ของ ${u.username}? Secret เดิม, Recovery Code, อุปกรณ์ที่เชื่อถือ และ session ทั้งหมดจะใช้ไม่ได้ทันที ผู้ใช้ต้องสแกน QR ใหม่ตอนเข้าสู่ระบบครั้งถัดไป`,
                )
              )
                return;
              try {
                await api(`users/${u.id}/2fa/reset`, "POST", {});
                message(`รีเซ็ต 2FA ของ ${u.username} แล้ว`);
              } catch (e) {
                message(e.message, true);
              }
            },
            "action-edit",
          ),
        );
      if (u.id !== me.id)
        actions.append(
          button(
            "ลบ",
            async () => {
              if (
                !confirm(
                  `ยืนยันการลบผู้ใช้ ${u.username} หรือไม่? การลบไม่สามารถย้อนกลับได้`,
                )
              )
                return;
              try {
                await api("users/" + u.id, "DELETE");
                message("ลบผู้ใช้แล้ว");
                await show("users");
              } catch (e) {
                message(e.message, true);
              }
            },
            "action-delete",
          ),
        );
      return [person, role, state, actions];
    }),
  );
  list.querySelector(".table-scroll")?.classList.add("users-table");
}
function editUser(user) {
  content.querySelector("#user-editor")?.remove();
  const panel = card(user ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้");
  panel.id = "user-editor";
  if (user) panel.classList.add("editing-user");
  const form = node("form"),
    grid = node("div", undefined, "admin-grid");
  form.append(grid);
  panel.append(form);
  field(grid, "ชื่อ–นามสกุล", "full_name", user?.full_name).required = true;
  field(grid, "Username", "username", user?.username).required = true;
  const role = select(
    grid,
    "Role",
    "role",
    catalog.roles.filter(
      (r) => me.role === "super_admin" || r.code !== "super_admin",
    ),
    user?.role || "admin",
  );
  if (me.role !== "super_admin" && user) role.disabled = true;
  const toggles = node("div", undefined, "admin-toggles"),
    active = toggle(
      toggles,
      "เปิดใช้งานบัญชี",
      "ปิดแล้วผู้ใช้จะเข้าสู่ระบบไม่ได้",
      "is_active",
      user?.is_active ?? true,
    ),
    twoFactor = toggle(
      toggles,
      "บังคับใช้ 2FA",
      "ต้องกรอกรหัส 6 หลักจากแอป Authenticator ทุกครั้งที่เข้าสู่ระบบ",
      "two_factor",
      user?.twoFactorRequired ?? false,
    ),
    twoFactorHint = twoFactor.parentElement.querySelector("small");
  grid.append(toggles);
  twoFactor.disabled = me.role !== "super_admin";
  const currentPass = user
    ? field(
        grid,
        "รหัสผ่านเดิม (จำเป็นเมื่อเปลี่ยนรหัส)",
        "currentPassword",
        "",
        "password",
      )
    : null;
  if (currentPass) {
    currentPass.autocomplete = "current-password";
    currentPass.placeholder = "กรอกรหัสผ่านเดิมเพื่อยืนยัน";
  }
  const pass = field(
    grid,
    user ? "รหัสผ่านใหม่ (เว้นว่างเพื่อคงเดิม)" : "รหัสผ่าน",
    "password",
    "",
    "password",
  );
  pass.required = !user;
  pass.id = "user-password";
  pass.placeholder = user ? "กรอกรหัสผ่านใหม่" : "";
  const passwordLabel = pass.parentElement,
    passwordField = node("div", undefined, "admin-password-field"),
    passwordRow = node("div", undefined, "admin-password-row");
  passwordLabel.htmlFor = pass.id;
  passwordLabel.replaceWith(passwordField);
  passwordField.append(passwordLabel, passwordRow);
  const togglePassword = button("แสดง", () => {
    const show = pass.type === "password";
    pass.type = show ? "text" : "password";
    togglePassword.textContent = show ? "ซ่อน" : "แสดง";
    togglePassword.setAttribute(
      "aria-label",
      show ? "ซ่อนรหัสผ่านที่กรอก" : "แสดงรหัสผ่านที่กรอก",
    );
    togglePassword.setAttribute("aria-pressed", String(show));
  });
  togglePassword.setAttribute("aria-controls", pass.id);
  togglePassword.setAttribute("aria-label", "แสดงรหัสผ่านที่กรอก");
  togglePassword.setAttribute("aria-pressed", "false");
  togglePassword.disabled = true;
  passwordRow.append(pass, togglePassword);
  const passwordHint = node("small", undefined, "muted");
  passwordHint.id = "user-password-hint";
  passwordHint.setAttribute("role", "status");
  pass.setAttribute("aria-describedby", passwordHint.id);
  passwordField.append(passwordHint);
  const updatePasswordHint = () => {
    togglePassword.disabled = !pass.value;
    if (currentPass) currentPass.required = Boolean(pass.value);
    passwordHint.textContent = user
      ? pass.value
        ? "กรอกรหัสผ่านเดิมให้ถูกต้อง แล้วกดบันทึกเพื่อเปลี่ยนรหัส"
        : "เว้นว่างทั้งสองช่องเพื่อคงรหัสผ่านเดิม"
      : "กดแสดงเพื่อตรวจรหัสผ่านที่กำลังกรอก";
    if (!pass.value) {
      pass.type = "password";
      togglePassword.textContent = "แสดง";
      togglePassword.setAttribute("aria-label", "แสดงรหัสผ่านที่กรอก");
      togglePassword.setAttribute("aria-pressed", "false");
    }
  };
  pass.addEventListener("input", updatePasswordHint);
  updatePasswordHint();
  const permissions = node("fieldset");
  permissions.append(node("legend", "Additional Permissions"));
  const checks = node("div", undefined, "checks");
  permissions.append(checks);
  form.append(permissions);
  for (const p of catalog.permissions.filter(
    (p) => p.code !== "environment_settings",
  )) {
    const c = check(
      checks,
      p.name,
      "permissions",
      p.code,
      user?.additionalPermissions?.includes(p.code),
    );
    c.disabled = me.role !== "super_admin";
  }
  const territory = node("fieldset");
  territory.append(node("legend", "Sales Territories"));
  const tchecks = node("div", undefined, "checks");
  territory.append(tchecks);
  form.append(territory);
  for (const t of catalog.territories.filter((t) => t.is_active)) {
    const c = check(
      tchecks,
      t.name,
      "territories",
      t.id,
      user?.territoryIds?.includes(t.id),
    );
    c.disabled = me.role !== "super_admin";
  }
  const defaults = node("p", undefined, "muted");
  grid.append(defaults);
  const update = () => {
    const r = catalog.roles.find((r) => r.code === role.value);
    territory.hidden = r?.scope !== "territory";
    const always = role.value === "super_admin";
    if (always) twoFactor.checked = true;
    twoFactor.disabled = always || me.role !== "super_admin";
    twoFactorHint.textContent = always
      ? "Super Admin ต้องใช้ 2FA เสมอ ปิดไม่ได้"
      : me.role !== "super_admin"
        ? "เฉพาะ Super Admin เท่านั้นที่กำหนดได้"
        : "ต้องกรอกรหัส 6 หลักจากแอป Authenticator ทุกครั้งที่เข้าสู่ระบบ";
    defaults.textContent =
      "สิทธิ์ตาม Role: " +
      (r?.permissions
        .map((p) => catalog.permissions.find((x) => x.code === p)?.name || p)
        .join(", ") || "ยังไม่มี");
  };
  role.onchange = update;
  update();
  submit(form, "บันทึกผู้ใช้", async (data) => {
    await api("users" + (user ? "/" + user.id : ""), user ? "PUT" : "POST", {
      username: data.get("username"),
      full_name: data.get("full_name"),
      role: role.value,
      is_active: active.checked,
      twoFactorRequired:
        me.role === "super_admin" ? twoFactor.checked : undefined,
      currentPassword: data.get("currentPassword") || undefined,
      password: data.get("password") || undefined,
      additionalPermissions:
        me.role === "super_admin" ? selected(form, "permissions") : [],
      territoryIds:
        me.role === "super_admin" && !territory.hidden
          ? selected(form, "territories").map(Number)
          : [],
    });
    await show("users");
  });
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function territoriesView() {
  const list = card("เขตการขาย"),
    intro = node(
      "p",
      "Mapping เริ่มต้นใช้รหัสทีมและกลุ่มสินค้าฝากชุดเดิม รหัสที่ไม่กำหนดจะไม่เปิดให้ Sales เห็น",
      "muted",
    ),
    toolbar = node("div", undefined, "territories-toolbar"),
    summary = node(
      "p",
      `${catalog.territories.length} เขต · เปิดใช้งาน ${catalog.territories.filter((t) => t.is_active).length} เขต`,
      "territories-summary",
    );
  toolbar.append(
    summary,
    button("+ เพิ่มเขต", () => editTerritory(), "primary"),
  );
  list.append(intro, toolbar);
  table(
    list,
    ["Territory code", "ชื่อเขต", "สถานะ", "การจัดการ"],
    catalog.territories.map((t) => {
      const code = node("code", t.code, "territory-code"),
        state = node(
          "span",
          t.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน",
          t.is_active ? "territory-status active" : "territory-status inactive",
        );
      return [
        code,
        t.name,
        state,
        button("แก้ไขเขต", () => editTerritory(t), "territory-edit-button"),
      ];
    }),
  );
  list.querySelector(".table-scroll")?.classList.add("territories-table");
}
function editTerritory(territory) {
  content.querySelector("#territory-editor")?.remove();
  const panel = card(territory ? "แก้ไขเขต" : "เพิ่มเขต");
  panel.id = "territory-editor";
  const helpButton = button(
    "?",
    () => {
      const open = help.hidden;
      help.hidden = !open;
      helpButton.setAttribute("aria-expanded", String(open));
      helpButton.setAttribute(
        "aria-label",
        open ? "ซ่อนคำอธิบายการกำหนดเขต" : "ดูคำอธิบายการกำหนดเขต",
      );
    },
    "territory-help-button",
  );
  helpButton.setAttribute("aria-label", "ดูคำอธิบายการกำหนดเขต");
  helpButton.setAttribute("aria-controls", "territory-help");
  helpButton.setAttribute("aria-expanded", "false");
  const help = node("aside", undefined, "territory-help");
  help.id = "territory-help";
  help.hidden = true;
  help.append(
    node("strong", "วิธีกำหนดขอบเขตข้อมูล"),
    node(
      "p",
      "ระบบจะแสดงข้อมูลที่ตรงกับรหัสทีมขาย หรือรหัสลูกค้าเพิ่มเติมอย่างใดอย่างหนึ่ง ส่วนรหัสกลุ่มสินค้าฝากใช้จำกัดข้อมูลในเมนูรับ–เบิกสินค้าฝาก",
    ),
  );
  const helpList = node("ul");
  for (const text of [
    "รหัสทีมขาย: ใช้ค่า sale_code เช่น กจ, กบ",
    "รหัสลูกค้าเพิ่มเติม: ใส่รหัสลูกค้าแบบเต็ม เมื่อต้องการรวมลูกค้าที่ไม่ตรงกับทีมขาย",
    "รหัสกลุ่มสินค้าฝาก: ต้องขึ้นต้นด้วย ฝ เช่น ฝกจ, ฝกบ",
    "กรอกหลายรหัสโดยคั่นด้วยจุลภาค และปิด “เปิดใช้งาน” หากยังไม่ต้องการให้เลือกเขตนี้",
  ])
    helpList.append(node("li", text));
  help.append(helpList);
  panel.append(helpButton, help);
  const form = node("form"),
    grid = node("div", undefined, "admin-grid");
  panel.append(form);
  form.append(grid);
  field(grid, "Territory Code เช่น BKK", "code", territory?.code).required =
    true;
  field(grid, "ชื่อเขต", "name", territory?.name).required = true;
  const active = check(
    grid,
    "เปิดใช้งาน",
    "active",
    "1",
    territory?.is_active ?? true,
  );
  for (const [key, label] of [
    ["teams", "รหัสทีมขาย เช่น กจ, หย"],
    ["customerCodes", "รหัสลูกค้าเพิ่มเติม (ตรงรหัสเต็ม)"],
    ["consignmentPrefixes", "รหัสกลุ่มสินค้าฝาก เช่น ฝกจ, ฝหย"],
  ]) {
    const input = field(
      grid,
      label,
      key,
      territory?.mapping[key]?.join(", ") || "",
      "textarea",
    );
    input.maxLength = 20000;
  }
  form.append(
    node(
      "p",
      "แยกรหัสด้วยจุลภาค รหัสทีมอ้างอิง sale_code; รหัสลูกค้าเพิ่มเติมรวมเอกสารของลูกค้านั้นในเขตนี้",
      "muted",
    ),
  );
  submit(form, "บันทึกเขต", async (data) => {
    const mapping = {};
    for (const key of ["teams", "customerCodes", "consignmentPrefixes"])
      mapping[key] = String(data.get(key))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    await api(
      "territories" + (territory ? "/" + territory.id : ""),
      territory ? "PUT" : "POST",
      {
        code: data.get("code"),
        name: data.get("name"),
        is_active: active.checked,
        mapping,
      },
    );
    await refreshCatalog();
    await show("territories");
  });
  panel.scrollIntoView({ behavior: "smooth" });
}
async function rolesView() {
  if (me.role !== "super_admin") {
    card("Roles").append(node("p", "การแก้ Role ต้องใช้ Super Admin"));
    return;
  }
  const list = card("Roles"),
    summary = node(
      "p",
      `${catalog.roles.length} ระดับสิทธิ์ที่กำหนดไว้`,
      "roles-summary",
    );
  list.append(summary);
  table(
    list,
    ["Code", "ชื่อ Role", "ขอบเขตข้อมูล", "การจัดการ"],
    catalog.roles.map((r) => {
      const code = node("code", r.code, "role-code"),
        scope = node(
          "span",
          r.scope === "territory"
            ? "เฉพาะเขตที่ได้รับมอบหมาย"
            : "เข้าถึงทุกเขต",
          r.scope === "territory" ? "scope-chip territory" : "scope-chip all",
        ),
        action =
          r.code === "super_admin"
            ? node("span", "สิทธิ์ครบทุกส่วน", "role-locked")
            : button(
                "จัดการสิทธิ์",
                () => editRole(r),
                "role-permission-button",
              );
      return [code, r.name, scope, action];
    }),
  );
  list.querySelector(".table-scroll")?.classList.add("roles-table");
  const panel = card("เพิ่ม Role"),
    form = node("form"),
    intro = node(
      "p",
      "สร้างระดับสิทธิ์ใหม่ แล้วกำหนดสิทธิ์การใช้งานในขั้นตอนถัดไป",
      "muted",
    ),
    grid = node("div", undefined, "admin-grid role-form-grid");
  panel.append(form);
  form.append(intro, grid);
  field(grid, "Code", "code").required = true;
  field(grid, "ชื่อ Role", "name").required = true;
  const scope = select(
    grid,
    "ขอบเขตข้อมูล",
    "scope",
    [
      { code: "territory", name: "เฉพาะเขตที่ได้รับมอบหมาย" },
      { code: "all", name: "เข้าถึงทุกเขต" },
    ],
    "territory",
  );
  scope.parentElement.classList.add("role-scope-field");
  submit(form, "เพิ่ม Role", async (data) => {
    await api("roles", "POST", Object.fromEntries(data));
    await refreshCatalog();
    await show("roles");
  });
}
function editRole(role) {
  content.querySelector("#role-editor")?.remove();
  const panel = card("สิทธิ์ของ " + role.name);
  panel.id = "role-editor";
  const form = node("form");
  panel.append(form);
  field(form, "ชื่อ Role", "name", role.name).required = true;
  const checks = node("div", undefined, "checks");
  form.append(checks);
  for (const p of catalog.permissions.filter(
    (p) => p.code !== "environment_settings",
  ))
    check(
      checks,
      p.name,
      "permissions",
      p.code,
      role.permissions.includes(p.code),
    );
  submit(form, "บันทึกและให้ผู้ใช้ Role นี้เข้าสู่ระบบใหม่", async (data) => {
    await api("roles/" + role.id, "PUT", {
      name: data.get("name"),
      permissions: selected(form, "permissions"),
    });
    await refreshCatalog();
    await show("roles");
  });
  panel.scrollIntoView({ behavior: "smooth" });
}
function permissionArea(code) {
  return [
    "users_manage",
    "roles_manage",
    "territories_manage",
    "system_settings",
    "environment_settings",
    "activity_logs",
  ].includes(code)
    ? "จัดการระบบ"
    : "พื้นที่ทำงาน";
}
async function permissionsView() {
  const list = card("Permissions"),
    summary = node(
      "p",
      `${catalog.permissions.length} สิทธิ์สำหรับกำหนดการเข้าถึงของผู้ใช้งาน`,
      "permissions-summary",
    );
  list.append(summary);
  table(
    list,
    ["Permission code", "คำอธิบาย", "กลุ่ม"],
    catalog.permissions.map((p) => {
      const code = node("code", p.code, "permission-code"),
        area = permissionArea(p.code);
      return [
        code,
        p.name,
        node(
          "span",
          area,
          area === "จัดการระบบ"
            ? "permission-area admin"
            : "permission-area workspace",
        ),
      ];
    }),
  );
  list.querySelector(".table-scroll")?.classList.add("permissions-table");
  if (me.role !== "super_admin") return;
  const panel = card("เพิ่ม Permission"),
    form = node("form");
  panel.append(form);
  field(form, "Code", "code").required = true;
  field(form, "ชื่อ", "name").required = true;
  form.append(
    node(
      "p",
      "หลังเพิ่ม Permission ผู้พัฒนาต้องผูกกับ Route/API ของโมดูลใหม่ด้วย requirePermission",
      "muted",
    ),
  );
  submit(form, "เพิ่ม Permission", async (data) => {
    await api("permissions", "POST", Object.fromEntries(data));
    await refreshCatalog();
    await show("permissions");
  });
}
async function settingsView(environment = false) {
  const values = await api(environment ? "environment" : "settings"),
    panel = card(environment ? "Environment Settings" : "System Settings"),
    form = node("form");
  panel.append(form);
  const keys = environment
    ? ["PGHOST", "PGPORT", "PGDATABASE", "API_URL", "DASHBOARD_NAME"]
    : ["dashboard_name", "support_message"];
  if (environment) {
    panel.classList.add("environment-card");
    const notice = node("aside", undefined, "environment-notice");
    notice.append(
      node("strong", "การตั้งค่าระดับระบบ"),
      node(
        "p",
        "แก้ได้เฉพาะรายการที่อนุญาต ไม่มีรหัสผ่านหรือ Secret แสดงในหน้านี้ ทุกการเปลี่ยนแปลงต้องเริ่มเซิร์ฟเวอร์ใหม่จึงจะมีผล",
      ),
    );
    const connection = node("section", undefined, "environment-group"),
      connectionTitle = node("div", undefined, "environment-group-title"),
      connectionGrid = node("div", undefined, "admin-grid environment-grid");
    connectionTitle.append(
      node("h3", "การเชื่อมต่อข้อมูล"),
      node("p", "ใช้สำหรับเชื่อมต่อฐานข้อมูลและบริการภายใน"),
    );
    connection.append(connectionTitle, connectionGrid);
    for (const key of ["PGHOST", "PGPORT", "PGDATABASE"])
      field(connectionGrid, key, key, values[key] || "");
    const display = node("section", undefined, "environment-group"),
      displayTitle = node("div", undefined, "environment-group-title"),
      displayGrid = node("div", undefined, "admin-grid environment-grid");
    displayTitle.append(
      node("h3", "การแสดงผลระบบ"),
      node("p", "กำหนดปลายทางบริการและชื่อที่แสดงใน dashboard"),
    );
    display.append(displayTitle, displayGrid);
    for (const key of ["API_URL", "DASHBOARD_NAME"])
      field(displayGrid, key, key, values[key] || "");
    form.append(notice, connection, display);
  } else for (const key of keys) field(form, key, key, values[key] || "");
  submit(form, "บันทึก", async (data) => {
    const body = Object.fromEntries([...data].filter(([, v]) => v.trim()));
    const result = await api(
      environment ? "environment" : "settings",
      "PUT",
      body,
    );
    if (result.restartRequired)
      panel.append(
        node(
          "p",
          "บันทึกแล้ว กรุณาเริ่มเซิร์ฟเวอร์ใหม่เพื่อใช้ Environment ที่แก้ไข",
          "muted",
        ),
      );
  });
}
const activityTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function activityTime(value) {
  if (typeof value !== "string" || !value.trim()) return "ไม่ระบุเวลา";
  // SQLite CURRENT_TIMESTAMP is UTC, but its text has no timezone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T") + "Z"
    : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return "ไม่ระบุเวลา";
  const parts = Object.fromEntries(
    activityTimeFormat.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function activityStamp(value) {
  const text = activityTime(value),
    [date, time] = text.split(" "),
    stamp = node("div", undefined, "activity-stamp");
  stamp.append(node("strong", time || text));
  if (time) stamp.append(node("span", date));
  return stamp;
}
function activityBadge(action) {
  const labels = {
      login: "เข้าสู่ระบบ",
      logout: "ออกจากระบบ",
      "login.failed": "เข้าสู่ระบบไม่สำเร็จ",
      "user.create": "เพิ่มผู้ใช้",
      "user.update": "แก้ไขผู้ใช้",
      "user.delete": "ลบผู้ใช้",
      "user.role": "เปลี่ยน Role",
      "user.permissions": "กำหนดสิทธิ์ผู้ใช้",
      "user.territories": "กำหนดเขตผู้ใช้",
      "user.password_reset": "เปลี่ยนรหัสผ่าน",
      "territory.create": "เพิ่มเขตขาย",
      "territory.update": "แก้ไขเขตขาย",
      "territory.switch": "เปลี่ยนเขตขาย",
      "role.create": "เพิ่ม Role",
      "role.permissions": "กำหนดสิทธิ์ Role",
      "permission.create": "เพิ่ม Permission",
      "settings.update": "แก้ไขการตั้งค่าระบบ",
      "environment.update": "แก้ไข Environment",
      "sessions.revoke": "ออกจากระบบทุกอุปกรณ์",
      "user.password_change": "เปลี่ยนรหัสผ่าน",
      "account.locked": "ล็อกบัญชีชั่วคราว",
      "2fa.enrolled": "เปิดใช้ 2FA",
      "2fa.verified": "ยืนยัน 2FA",
      "2fa.failed": "ยืนยัน 2FA ไม่สำเร็จ",
      "2fa.recovery_used": "ใช้ Recovery Code",
      "2fa.recovery_regenerated": "สร้าง Recovery Code ใหม่",
      "2fa.reset": "รีเซ็ต 2FA",
      "2fa.policy": "กำหนดการใช้ 2FA",
      "trusted_device.add": "เชื่อถืออุปกรณ์",
      "trusted_device.revoke": "ยกเลิกอุปกรณ์ที่เชื่อถือ",
      "auth.logout_all": "ออกจากระบบทุกอุปกรณ์",
    },
    kind =
      action === "login"
        ? "login"
        : action === "logout"
          ? "logout"
          : ["login.failed", "account.locked", "2fa.failed"].includes(action)
            ? "failed"
            : "change";
  return node("span", labels[action] || action, "activity-badge " + kind);
}
function activityDetail(log) {
  const details =
      log.details && typeof log.details === "object" ? log.details : {},
    detail = node("div", undefined, "activity-detail"),
    user = (id) =>
      log.targetUser?.full_name ||
      log.targetUser?.username ||
      `บัญชีผู้ใช้ ID ${id}`,
    territory = (id) =>
      catalog.territories.find((t) => Number(t.id) === Number(id))?.name ||
      `เขต ID ${id}`,
    permission = (code) =>
      catalog.permissions.find((p) => p.code === code)?.name || code,
    add = (main, sub) => {
      detail.append(node("strong", main));
      if (sub) detail.append(node("span", sub));
      return detail;
    };
  if (["login", "logout"].includes(log.action))
    return add(
      log.action === "login" ? "เข้าสู่ระบบสำเร็จ" : "ออกจากระบบเรียบร้อย",
    );
  if (log.action === "login.failed")
    return add(
      "เข้าสู่ระบบไม่สำเร็จ",
      {
        bad_password: "รหัสผ่านไม่ถูกต้อง",
        unknown_user: "ไม่พบชื่อผู้ใช้",
        locked: "บัญชีถูกล็อกอยู่",
        inactive: "บัญชีถูกปิดใช้งาน",
      }[details.reason] || "ตรวจสอบชื่อผู้ใช้หรือรหัสผ่านอีกครั้ง",
    );
  if (log.action === "account.locked")
    return add(
      `ล็อกบัญชี ${user(details.userId)}`,
      `กรอกผิดเกินกำหนด ล็อก ${details.minutes || 15} นาที`,
    );
  if (log.action.startsWith("2fa.") || log.action.startsWith("trusted_device."))
    return add(
      {
        "2fa.enrolled": "เปิดใช้ 2FA",
        "2fa.verified": "ยืนยัน 2FA สำเร็จ",
        "2fa.failed": "ยืนยัน 2FA ไม่สำเร็จ",
        "2fa.recovery_used": "เข้าสู่ระบบด้วย Recovery Code",
        "2fa.recovery_regenerated": "สร้าง Recovery Code ชุดใหม่",
        "2fa.reset": "รีเซ็ต 2FA",
        "trusted_device.add": "เชื่อถืออุปกรณ์",
        "trusted_device.revoke": "ยกเลิกอุปกรณ์ที่เชื่อถือ",
      }[log.action],
      user(details.userId),
    );
  if (log.action === "auth.logout_all")
    return add(`ออกจากระบบทุกอุปกรณ์ของ ${user(details.userId)}`);
  if (log.action === "user.create")
    return add(
      `เพิ่ม ${user(details.userId)}`,
      details.is_active ? "เปิดใช้งานบัญชี" : "สร้างเป็นบัญชีที่ปิดใช้งาน",
    );
  if (log.action === "user.update")
    return add(
      `ปรับข้อมูล ${user(details.userId)}`,
      details.is_active ? "เปิดใช้งานบัญชี" : "ปิดใช้งานบัญชี",
    );
  if (log.action === "user.delete") return add(`ลบ ${user(details.userId)}`);
  if (log.action === "user.role")
    return add(
      `เปลี่ยน Role ของ ${user(details.userId)}`,
      details.role || "ไม่ระบุ Role",
    );
  if (log.action === "user.permissions") {
    const items = Array.isArray(details.permissions)
      ? details.permissions.map(permission)
      : [];
    return add(
      `กำหนดสิทธิ์ให้ ${user(details.userId)}`,
      items.length ? items.join(" · ") : "ไม่ได้กำหนดสิทธิ์เพิ่มเติม",
    );
  }
  if (log.action === "user.territories") {
    const items = Array.isArray(details.territoryIds)
      ? details.territoryIds.map(territory)
      : [];
    return add(
      `กำหนดเขตให้ ${user(details.userId)}`,
      items.length ? items.join(" · ") : "ไม่ได้กำหนดเขตขาย",
    );
  }
  if (log.action === "user.password_reset")
    return add(`เปลี่ยนรหัสผ่านของ ${user(details.userId)}`);
  if (["territory.create", "territory.update"].includes(log.action)) {
    const mapping = details.mapping || {},
      parts = [
        ["ทีมขาย", mapping.teams],
        ["รหัสลูกค้า", mapping.customerCodes],
        ["กลุ่มสินค้าฝาก", mapping.consignmentPrefixes],
      ].map(
        ([label, items]) =>
          `${label} ${Array.isArray(items) ? items.length : 0} รายการ`,
      );
    return add(
      `${log.action === "territory.create" ? "เพิ่ม" : "อัปเดต"}เขต ${details.code || ""}`.trim(),
      parts.join(" · "),
    );
  }
  if (log.action === "territory.switch")
    return add("เปลี่ยนเขตที่ใช้งาน", territory(details.territoryId));
  if (log.action === "role.create")
    return add(`เพิ่ม Role ${details.code || ""}`.trim());
  if (log.action === "role.permissions") {
    const items = Array.isArray(details.permissions)
      ? details.permissions.map(permission)
      : [];
    return add(
      `กำหนดสิทธิ์ให้ Role ${details.role || ""}`.trim(),
      items.length ? items.join(" · ") : "ไม่มีสิทธิ์ที่กำหนด",
    );
  }
  if (log.action === "permission.create")
    return add(`เพิ่ม Permission ${details.code || ""}`.trim());
  if (["settings.update", "environment.update"].includes(log.action)) {
    const keys = Array.isArray(details.keys) ? details.keys : [];
    return add(
      log.action === "settings.update"
        ? "อัปเดตการตั้งค่าระบบ"
        : "อัปเดต Environment",
      keys.length
        ? `รายการที่เปลี่ยน: ${keys.join(" · ")}`
        : "มีการบันทึกการตั้งค่า",
    );
  }
  if (log.action === "sessions.revoke")
    return add(`บังคับออกจากระบบทุกอุปกรณ์ของ ${user(details.userId)}`);
  return add("มีการเปลี่ยนแปลงข้อมูลในระบบ");
}
async function activityView() {
  const before = auditCursors[auditPage],
    { logs } = await api("activity" + (before ? "?before=" + before : "")),
    panel = card("Activity Log"),
    pageLogs = logs.slice(0, 10),
    hasNext = logs.length > 10;
  table(
    panel,
    ["เวลาไทย (UTC+7)", "ผู้ใช้", "กิจกรรม", "รายละเอียด"],
    pageLogs.map((l) => [
      activityStamp(l.created_at),
      l.username || "ไม่ระบุตัวตน",
      activityBadge(l.action),
      activityDetail(l),
    ]),
  );
  panel.querySelector(".table-scroll")?.classList.add("activity-log-table");
  panel.querySelector(".table-scroll")?.classList.add("activity-log-table");
  const pager = node("div", undefined, "admin-pagination"),
    previous = button("← ก่อนหน้า", () => {
      if (auditPage > 0) {
        auditPage--;
        show("activity");
      }
    }),
    pageLabel = node("span", `หน้า ${auditPage + 1}`),
    next = button("ถัดไป →", () => {
      if (!hasNext || !pageLogs.length) return;
      auditCursors[auditPage + 1] = pageLogs.at(-1).id;
      auditPage++;
      show("activity");
    });
  previous.disabled = auditPage === 0;
  next.disabled = !hasNext;
  pager.append(previous, pageLabel, next);
  panel.append(pager);
}
async function securityView() {
  const data = await api("security"),
    panel = card("Security"),
    sessions = data.sessions.reduce((n, s) => n + Number(s.sessions || 0), 0),
    online = data.sessions.filter((s) => Number(s.sessions) > 0).length,
    summary = node("div", undefined, "security-summary"),
    stat = (label, value, detail) => {
      const box = node("div", undefined, "security-stat");
      box.append(
        node("span", label),
        node("strong", String(value)),
        node("small", detail),
      );
      summary.append(box);
    };
  panel.classList.add("security-card");
  const notice = node("aside", undefined, "security-notice");
  notice.append(
    node("strong", "การป้องกันระบบทำงานอยู่"),
    node(
      "p",
      "รหัสผ่านจัดเก็บด้วย bcrypt · Cookie เป็น HttpOnly · SML เป็นแบบอ่านอย่างเดียว · ไม่มี Localhost bypass",
    ),
  );
  stat("Session ที่ใช้งาน", sessions, "รายการ");
  stat("ผู้ใช้ที่ออนไลน์", online, "บัญชี");
  stat("การเชื่อมต่อ SML", "Read-only", "ป้องกันการแก้ไขข้อมูล");
  panel.append(
    notice,
    summary,
    node("h3", "Session ของผู้ใช้งาน", "security-list-title"),
  );
  table(
    panel,
    ["ผู้ใช้", "Session ที่ใช้งาน", "สถานะ", "การจัดการ"],
    data.sessions.map((s) => {
      const count = Number(s.sessions || 0),
        state = node(
          "span",
          count ? "ออนไลน์" : "ไม่มี session",
          count ? "session-online" : "session-offline",
        ),
        revoke = button(
          "ออกจากระบบทุกอุปกรณ์ / เพิกถอนอุปกรณ์ที่เชื่อถือ",
          async () => {
            try {
              await api("security/revoke/" + s.id, "POST", {});
              await show("security");
            } catch (e) {
              message(e.message, true);
            }
          },
          count ? "security-revoke-button active" : "security-revoke-button",
        );
      return [s.username, count.toLocaleString("th-TH"), state, revoke];
    }),
  );
  panel.querySelector(".table-scroll")?.classList.add("security-table");
}
async function overviewView() {
  const p = card("ภาพรวมระบบ");
  p.append(node("p", "สถานะผู้ใช้งาน สิทธิ์ และเขตการขายของระบบ", "muted"));
  const grid = node("div", undefined, "admin-overview-grid");
  p.append(grid);
  const metric = (label, value, unit, description) => {
    const box = node("div", undefined, "admin-metric");
    box.append(
      node("span", label),
      node("strong", value),
      node("small", unit),
      node("p", description, "admin-metric-description"),
    );
    grid.append(box);
  };
  try {
    const users = has("users_manage") ? await api("users") : null;
    const security = me.role === "super_admin" ? await api("security") : null;
    const activity = has("activity_logs") ? await api("activity") : null;
    if (users) {
      const active = users.users.filter((u) => u.is_active).length,
        disabled = users.users.length - active;
      metric(
        "ผู้ใช้ทั้งหมด",
        users.users.length,
        "บัญชี",
        "จำนวนบัญชีที่ลงทะเบียนในระบบ",
      );
      metric(
        "เปิดใช้งาน",
        active,
        "บัญชี",
        "บัญชีที่สามารถเข้าสู่ระบบได้ในขณะนี้",
      );
      metric(
        "ปิดใช้งาน",
        disabled,
        "บัญชี",
        "บัญชีที่ถูกระงับและไม่สามารถใช้งานได้",
      );
    }
    if (has("roles_manage"))
      metric(
        "Role",
        catalog.roles.length,
        "รายการ",
        "ระดับสิทธิ์ที่กำหนดไว้ในระบบ",
      );
    if (has("territories_manage"))
      metric(
        "เขตที่เปิดใช้งาน",
        catalog.territories.filter((t) => t.is_active).length,
        "เขต",
        "เขตที่พร้อมมอบหมายให้ผู้ใช้งาน",
      );
    if (security) {
      const sessions = security.sessions.reduce(
        (n, s) => n + Number(s.sessions || 0),
        0,
      );
      metric(
        "Session ที่ใช้งาน",
        sessions,
        "รายการ",
        "การเข้าสู่ระบบที่ยังไม่หมดอายุ",
      );
      const online = card("ผู้ใช้งานที่กำลังใช้งาน");
      online.append(
        node("p", "ผู้ใช้ที่มี Session กำลังใช้งานอยู่ในขณะนี้", "muted"),
      );
      const onlineRows = security.sessions.filter(
        (s) => Number(s.sessions) > 0,
      );
      if (onlineRows.length)
        table(
          online,
          ["ผู้ใช้", "จำนวน Session", "สถานะ"],
          onlineRows.map((s) => [
            s.username,
            Number(s.sessions).toLocaleString("th-TH"),
            node("span", "ออนไลน์", "session-online"),
          ]),
        );
      else online.append(node("p", "ขณะนี้ยังไม่มีผู้ใช้งานออนไลน์", "muted"));
    }
    if (activity) {
      const recent = card("กิจกรรมล่าสุด");
      recent.classList.add("recent-activity-card");
      recent.append(
        node("p", "รายการการเข้าสู่ระบบและการเปลี่ยนแปลงในระบบล่าสุด", "muted"),
      );
      if (activity.logs.length) {
        const tableLabel = node(
          "p",
          `${activity.logs.length} รายการล่าสุด`,
          "activity-list-summary",
        );
        recent.append(tableLabel);
        table(
          recent,
          ["เวลา", "ผู้ใช้", "กิจกรรม"],
          activity.logs
            .slice(0, 5)
            .map((l) => [
              activityStamp(l.created_at),
              l.username || "ไม่ระบุตัวตน",
              activityBadge(l.action),
            ]),
        );
        recent
          .querySelector(".table-scroll")
          ?.classList.add("recent-activity-table");
      } else recent.append(node("p", "ยังไม่มีกิจกรรม", "muted"));
    }
  } catch (error) {
    p.append(node("p", error.message, "admin-status"));
  }
}
const views = {
  overview: overviewView,
  users: usersView,
  territories: territoriesView,
  roles: rolesView,
  permissions: permissionsView,
  settings: () => settingsView(),
  environment: () => settingsView(true),
  activity: activityView,
  security: securityView,
};
async function show(key) {
  current = key;
  content.replaceChildren();
  message("กำลังโหลด…");
  for (const b of tabs.children)
    b.setAttribute("aria-selected", String(b.dataset.tab === key));
  try {
    await views[key]();
    message("");
  } catch (e) {
    message(e.message, true);
  }
}
try {
  const r = await fetch("/api/auth/me");
  if (!r.ok) throw new Error("กรุณาเข้าสู่ระบบ");
  me = await r.json();
  await refreshCatalog();
  for (const [key, label, p] of [
    ["overview", "Dashboard", null],
    ["users", "Users", "users_manage"],
    ["roles", "Roles", "super"],
    ["permissions", "Permissions", "super"],
    ["territories", "Sales Territories", "territories_manage"],
    ["settings", "System Settings", "system_settings"],
    ["environment", "Environment Settings", "super"],
    ["activity", "Activity Logs", "activity_logs"],
    ["security", "Security", "super"],
  ])
    if (!p || (p === "super" ? me.role === "super_admin" : has(p))) {
      const b = button(label, () => show(key));
      b.dataset.tab = key;
      tabs.append(b);
    }
  await show("overview");
} catch (e) {
  message(e.message, true);
}
