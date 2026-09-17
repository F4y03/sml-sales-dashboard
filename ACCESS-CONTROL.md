# Users, permissions and sales territories

## Start and existing accounts

Use Node.js **22.13+** (this workspace uses Node 24), `npm install`, then `npm start`.
The first start applies `migrations/001-access.sql` to **`data/access.sqlite`**, a separate SQLite database owned by the dashboard. No migration or write is sent to SML. Keep `data/` private and backed up; it is excluded from Git and is outside `public/`.

The existing `.env` account is imported once as Super Admin, retaining its login password. Subsequent restarts do not overwrite managed users from `.env`. Existing in-memory sessions require a new login after this upgrade. `AUTH_BYPASS_LOCAL` is no longer honored, including localhost requests.

Visit `/system-admin.html`, or **System Admin** in Workspace after logging in with the existing account. If no account exists or recovery is needed, run locally:

```powershell
node scripts/setup-auth.js
```

The CLI prompts for a hidden password, creates/recovers a Super Admin in SQLite, revokes that user's sessions, and records a recovery event. It does not write `.env` or SML. Protect filesystem access: anyone able to run this administrative CLI or edit SQLite has administrative control.

## Role defaults

| Role | Default pages/data | Management |
|---|---|---|
| Super Admin | All modules, all territories | Users, roles, additional permissions, territories, settings, environment, activity, session revocation |
| Executive | Dashboard, executive, stock, products, consignment, customer/product analysis, native reports; all territories | None unless granted additional permission |
| Admin | Price/stock, product information, consignment | None unless granted additional permission |
| Sales | Price/stock, consignment, customer/product analysis; selected assigned territory | No central administration |

Effective permissions are the union of role permissions and additional user permissions. Roles can be added, with an immutable data scope of `all` or `territory`. The built-in `sales` role always has territory scope. Super Admin has all current/future permissions; it cannot lose its built-in privileges, and the last active Super Admin cannot be disabled or demoted.

Central role/permission administration and Environment Settings require Super Admin. Delegated user managers cannot manage Super Admin, elevate their own account, grant privileges they do not hold, change role assignments on existing accounts, or assign additional permissions/territories. Those tasks remain with Super Admin. Territory-scoped accounts cannot receive central administration permissions because those screens cover all users/territories.

## Add or change a user

1. System Admin → Users → เพิ่มผู้ใช้.
2. Enter full name, unique username, role, active status and password (any non-empty length, at most 72 UTF-8 bytes).
3. Select additional permissions. Defaults inherited from the role appear above the form and are not copied into additional grants.
4. For a territory-scoped role, select one or more active territories; saving without territories is allowed but no business data can be accessed.
5. Save. Editing users, changing role permissions, disabling accounts or resetting passwords revokes affected sessions. Users log in again to get the new access.

To reset a password, edit the user and fill the new password field; blank preserves the current password. API also provides `POST /api/admin/users/:id/password`. User responses never include password hashes.

## Territories and mapping

System Admin → Sales Territories → เพิ่มเขต. Enter unique uppercase code, name, active status and mapping. Disable territories to immediately remove access; assignments are checked against SQLite on every request and every switch.

Seeded assignments come from the existing executive/consignment mapping:

| Code | Name | Team codes | Consignment prefixes |
|---|---|---|---|
| CENTRAL | ภาคกลาง | กจ, กณ, กต, กร, กภ, บอ | ฝกจ, ฝกณ, ฝกต, ฝกร, ฝกภ, ฝบอ |
| NORTH | ภาคเหนือ | หย | ฝหย |
| SOUTH | ภาคใต้ | ตช | ฝตช |
| EAST | ภาคตะวันออก | ลภ | ฝลภ |
| NORTHEAST | ภาคอีสาน | อย | ฝอย |

Bangkok or other territories can be added once their mapping is defined; unknown codes are not guessed. Existing `กท-` / `ฝ` team normalization is preserved. Different territories may intentionally share mappings; administrators must review overlaps before assigning accounts.

The mapping layer is `src/services/territoryService.js`:

- Sales documents use the normalized **header `ic_trans.sale_code`** in the selected territory, plus explicitly assigned full customer codes. This makes header totals and matching detail rows refer to the same documents.
- Detail rows must match an allowed header's document/date/type/customer, and branch when the header specifies one. Existing sales flag/date/NULL/business formulas remain intact.
- Customer master is limited to customers of allowed documents, explicit customer codes, or the existing team-code prefix convention (`ทีม-เลขลูกค้า`). This also scopes non-buyers.
- Consignment uses the existing explicit inventory prefix mapping, not a guessed `territory_id` column. It filters movements **before** cumulative stock calculation and restricts document drill-down too.
- Ordinary product master/prices/stock are shared product reference data. Territory-owned consignment inventory is filtered; transaction activity/customer/sales quantities are scoped. Product exports use the same scoped connection as the screen.
- No mapping means no transaction access. Nothing is written to SML.

No territories: “ยังไม่ได้รับการกำหนดเขตการขาย กรุณาติดต่อผู้ดูแลระบบ”. One active territory is selected automatically. Multiple territories lead to `/select-territory.html`. The top selector changes the server session's current territory; the backend ignores URL/body territory parameters on data APIs. Unauthorized selections return 403. If one assignment is removed and one remains, it becomes the active territory; otherwise the user must select again.

Scope is request-local via `AsyncLocalStorage`, passed through all query/connect paths. SQL parameters hold mapping values. Fixed application queries prepend scoped CTEs before aggregations, paging and exports; no frontend-only filtering is used.

**Native SML reports are intentionally unavailable to territory-scoped users even if Reports is added.** Their stored SQL/functions can access data outside CTE scope. Implement a reviewed territory-aware adapter for each native report before enabling it for Sales. Dashboard and analysis pages are available when their permissions are granted. This restriction must not be removed just to enable a menu.

## System, environment and activity

System Settings currently supports the dashboard name shown in Workspace and a support message shown on territory selection. Environment Settings only allows `PGHOST`, `PGPORT`, `PGDATABASE`, `API_URL`, `DASHBOARD_NAME`; the first three match this project's actual `pg` configuration (not unused `DB_*` aliases). Restart the Node process after environment edits. `API_URL` is stored for future integrations; it does not proxy requests or change current data sources.

Password/secret keys are absent from both reads and writes, not merely masked in HTML. Requests with other keys are rejected. Environment writes preserve unrelated lines, replace atomically, and log only changed key names. Security shows session counts and allows revocation without exposing session tokens.

Activity records logins/failures, logout, switches, user creation/edits/password resets, roles, additional grants, assignments, territory mappings, settings, environment key names and revocations. Records include actor, time, module and request socket IP where supplied. The dashboard's SML modules remain read-only: no product/consignment write operations were added, so there are no fabricated product/receipt/withdrawal mutation events. Add audit calls to any future authorized write workflow.

## Security and extensions

- New/reset passwords use bcrypt cost 12. Legacy scrypt hashes authenticate and upgrade on a successful login if compatible with the new password length bounds; longer legacy passwords continue authenticating until reset. No plaintext passwords are stored.
- Session tokens are random, only SHA-256 digests are stored in SQLite, with 8-hour expiry. HttpOnly, SameSite=Lax and Secure cookies by default; `AUTH_COOKIE_SECURE=false` is only for HTTP development. Sessions persist across restart; disabling users/version changes invalidate them.
- Mutation endpoints require the existing non-simple `X-PRPlus-Request: 1` header, reject cross-site requests and mismatched Origin, and do not enable CORS. This extends the existing CSRF defense.
- Login rate limiting remains 10 attempts/15 minutes per socket IP, with no trust in spoofed forwarded headers. Rate limits are in process memory; use one Node instance and an external rate limiter/shared store before scaling to multiple processes.
- Every known page/data API is mapped in `src/config/access.js`; unknown data routes/pages fail closed. `src/middleware/access.js` exports `requireLogin`, `requireRole`, `requirePermission`, `requireSuperAdmin`, `requireSalesTerritory`.
- To add a permission: create it in Permissions (or seed it in `PERMISSIONS` for a shipped module), add route/page policy and backend middleware, implement scoped data access if needed, add navigation logic and tests. A metadata permission alone does not expose a new route.
- New SML queries must use the scoped pool. Do not bypass it with schema-qualified base tables, stored functions, a raw client or a new database connection. Review every new sensitive table for scope; fixed scoped CTEs cover current application queries only.
- Migration lives in SQLite only. Preserve SQLite file and WAL with a consistent backup (stop the dashboard before filesystem backup); never apply `migrations/001-access.sql` to SML. Restoring an older access database also restores older assignments/sessions, so revoke sessions after restore.

## Files

Added: `migrations/001-access.sql`; `src/config/access.js`; `src/models/accessStore.js`; services `permissionService`, `passwordService`, `userService`, `territoryService`, `auditService`, `settingsService`; `src/middleware/access.js`; `src/routes/adminRoutes.js`; admin/territory/access-denied pages, scripts and `public/access-ui.css`; `test-rbac.js`, `test-access-ui.js`, `verify-access.js`.

Updated: `auth.js`, `server.js`, `scripts/setup-auth.js`, `public/login.js`, `public/workspace-nav.js`, `public/customers-ui.js`, `test-auth.js`, package manifest/lock, `.gitignore`, auth documentation. Existing customer/product/theme/navigation tests now use `test-support/fixture-identity.js` to model an authenticated Executive. The original page layouts, theme, navigation and login form are reused.

## Verification

```powershell
npm run test:access
$env:PLAYWRIGHT_CHANNEL='msedge'
node test-access-ui.js
node test-login-ui.js
node --env-file=.env verify-access.js
```

Unit/API tests use isolated stores and cover four roles, URL access, malicious territory selections, session revocation, disabled accounts, role overrides, last-Super-Admin protection, CSRF, secret exclusion, environment allowlist, migration idempotency and concurrent scope isolation. UI tests use temporary accounts and do not touch `.env` or SML. Screenshots go to ignored `test-results/`. `verify-access.js` runs SELECTs only against configured SML and checks scoped queries against independent SQL.
