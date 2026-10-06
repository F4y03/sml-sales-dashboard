// PreToolUse hook for Bash/PowerShell: blocks writes to SML and committing secrets/app data.
// Exit 2 = block (stderr is shown to Claude). No dependencies.
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let cmd = '';
try { cmd = JSON.parse(raw)?.tool_input?.command || ''; } catch { process.exit(0); }

const block = (why) => { process.stderr.write(`Blocked by sml-dashboard guard: ${why}\n`); process.exit(2); };

// SML is read-only: a command that talks to Postgres must not carry write/DDL SQL.
const talksToPg = /\bpsql\b|\bpg\.(Pool|Client)\b|from\s+['"]pg['"]|require\(['"]pg['"]\)/i.test(cmd);
const writesSql = /\b(INSERT\s+INTO|UPDATE\s+\w[\w.]*\s+SET|DELETE\s+FROM|DROP\s+(TABLE|SCHEMA|INDEX|VIEW|FUNCTION)|ALTER\s+TABLE|TRUNCATE|CREATE\s+(TABLE|INDEX|FUNCTION|VIEW))\b/i.test(cmd);
if (talksToPg && writesSql) block('SML is read-only (no INSERT/UPDATE/DELETE/DDL).');

// Never stage or commit secrets or the local access DB.
if (/\bgit\s+(add|commit)\b/.test(cmd) && /(^|[\s/'"])(\.env(?!\.example)\S*|data\/|\S+\.sqlite\b)/.test(cmd)) block('.env / data/ / *.sqlite must not go into Git.');
if (/\bgit\s+add\s+(-f|--force)\b/.test(cmd)) block('force-adding ignored files is not allowed.');

process.exit(0);
