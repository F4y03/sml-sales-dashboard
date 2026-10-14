// Sets the shared password for /product-sheet/products.html (stored as bcrypt in data/access.sqlite).
// Usage: node scripts/set-product-sheet-password.js   (takes effect immediately, no restart needed)
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { createAccessStore } from "../src/models/accessStore.js";
import { makePassword } from "../src/services/passwordService.js";
import { PASSWORD_KEY } from "../src/routes/productSheetProxy.js";

let hidden = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!hidden) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
async function secret(prompt) {
  process.stdout.write(prompt);
  hidden = true;
  try {
    return await rl.question("");
  } finally {
    hidden = false;
    process.stdout.write("\n");
  }
}
try {
  let password, confirm;
  if (process.stdin.isTTY) {
    password = await secret("New product-sheet password (input hidden): ");
    confirm = await secret("Confirm password: ");
  } else {
    // Piped input: readline drops buffered lines between questions, so read both lines at once.
    const lines = [];
    for await (const line of rl) lines.push(line);
    [password = "", confirm = ""] = lines;
  }
  if (password !== confirm) throw new Error("Passwords must match.");
  const hash = await makePassword(password);
  const store = createAccessStore(fileURLToPath(new URL("../data/access.sqlite", import.meta.url)));
  try {
    store.run("INSERT INTO system_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", PASSWORD_KEY, hash);
  } finally {
    store.close();
  }
  console.log("Product-sheet password saved. Existing page logins stay valid until they expire (12 hours) or the server restarts.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
