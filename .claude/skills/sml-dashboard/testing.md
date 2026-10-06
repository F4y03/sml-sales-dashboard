# Testing

Run only what matches the change. Never claim a pass you didn't run. Artifacts go in `test-results/` (git-ignored).

| Changed | Run |
|---|---|
| any `.js` | `node --check <file>` |
| auth, sessions, 2FA, trusted devices, lockout | `npm run test:access` (test-auth, test-rbac, test-security, test-2fa) |
| roles, permissions, scope, territories (`territoryService`, `userService`, `adminRoutes`, `access.js`) | `node test-rbac.js`, `node test-security.js` |
| `public/system-admin.js` UI | `node test-access-ui.js` (Playwright; currently fails on the `ui-new` row before any change — known pre-existing) |
| login page | `node test-login-ui.js`, `node test-login-2fa-ui.js` |
| products / customers / executive / reports / consignment | `test-<area>*.js` with the same name (e.g. `test-customers.js`, `test-consignment*.js`) |
| shared nav / theme | `node test-workspace-nav.js`, `node test-theme-modes.js` |
| needs live SML data | `verify-*.js` — only with the tunnel up |

## Logic check without UI (pattern)
For service changes, an in-memory store is fastest:
```js
import { createAccessStore } from './src/models/accessStore.js';
const store = createAccessStore();            // ':memory:', runs all migrations
// build services with an audit stub: { record(){} }
```
Put the scratch script in the scratchpad and delete it afterwards.

## Feedback loop
run → read failure → fix → rerun the same test → all green. If the failure also happens on `git stash`ed code, stop and report it as pre-existing.
