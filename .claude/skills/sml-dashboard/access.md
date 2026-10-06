# Users, scope, territories, 2FA

## Scope (who sees which data)
- Roles (`src/config/access.js`): `super_admin`, `executive`, `admin` = scope `all`; `sales` = scope `territory`.
- Per-user override `users.scope_override='territory'` limits an `all`-scope role (not super_admin) to assigned territories. Effective scope = `COALESCE(scope_override, role.scope)` in `loadUser`.
- Territory-scoped users: no native SML reports, no admin permissions (`ADMIN_PERMISSIONS`), `/api/admin` blocked.
- Permissions (checkboxes) only open pages; they never widen or narrow data scope.

## Territory form rules
- Code: Thai/English/digits/`_`/`-`, 2–40 chars, unique. No spaces, `()`, `.`. Name: free text.
- Team codes (`teams`): raw SML `sale_code` (e.g. `กท-ต`) or normalized (`กต`); `กท-X` also matches `กX`. Also matches customers whose code prefix before `-` equals the team.
- Customer codes: full codes, documents of that customer join the territory.
- Consignment prefixes: must start with `ฝ`, ≥3 chars, matched as item-code prefix (`ฝกต042LCD22` → `ฝกต`). `ฝกท-ต` matches nothing.
- Known region map (`public/consignment-data.js`): ภาคกลาง กจ กณ กต กร กภ บอ · เหนือ หย · ใต้ ตช · ตะวันออก ลภ · อีสาน อย. Others (ฝวย, ฝลอ…) are unmapped — never guess a region.
- All three lists empty → territory shows no data.

## 2FA / trusted devices
- Trust length: `trustDaysFor` in `src/services/twoFactorService.js` (30 days, all roles). UI fallbacks in `public/login.html` / `login.js` must match it.
- Unlimited devices per user. Trust is a cookie per browser + host: localhost and vrtunnel, other browsers, incognito each count as new devices.
- All trusted devices are revoked on password change/reset, 2FA reset, logout-all, admin revoke.
- Debug "asked for code again": read-only query on `data/access.sqlite` `activity_logs` (actions `trusted_device.*`, `2fa.*`, `user.password_reset`) — print action/user/time only, never tokens or hashes.

## Example
Input: "Admin `au` should see only ภาคกลางtik"
Output: Users → edit `au` → ขอบเขตข้อมูล = เฉพาะเขตที่กำหนด → tick ภาคกลางtik → save (user is logged out; next login is scoped).
