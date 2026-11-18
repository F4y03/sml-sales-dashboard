---
name: sml-recode-consignment
description: Move / rename consignment item codes in SML from one ฝ-prefix to another (e.g. "แก้ ฝบอ054 เป็น ฝกต209", "ย้าย ฝวย015 ไปเป็น ฝหย174"), including merging codes that already exist under the new prefix. Use whenever the user asks to change, move or merge a ฝxx000 consignment code in SML.
---

# ย้ายรหัสสินค้าฝากใน SML (ฝxx000 → ฝyy000)

This WRITES to SML. Rules in `AGENTS.md` (SML write section) always apply. Reply in Thai.

Consignment items are `ic_inventory.code` = 6-char prefix (`ฝ` + 2 Thai letters + 3 digits) + model, e.g. `ฝบอ054AH15`.
Moving `ฝบอ054` → `ฝกต209` replaces the first 6 chars in these tables (checked 2026-11: no triggers, no FKs):
`ic_inventory.code`, `ic_inventory_detail.ic_code`, `ic_unit_use.ic_code`, `ic_wh_shelf.ic_code`, `ic_trans_detail.item_code`.
`master_logs.code` is history: never edited.

## Steps
1. **Survey (read-only)** — run from the repo root:
   `node --env-file=.env .claude/skills/sml-recode-consignment/recode.cjs FROM TO`
   It prints rows per table, items / stock, how many codes TO already has, any MERGE lines, and the `--apply ITEMS TX` to use.
   - A table marked `UNKNOWN` or a MERGE with `UNIT DIFFERS` → stop and tell the user; do not apply.
2. **Show the plan in Thai** as a table (table, rows, แก้/ไม่แก้), say stock moved, list merges (old → target, both balances, result),
   and ask the user to close SML and answer "ตกลง". Never apply without that OK for this exact pair.
3. **Apply** with the exact counts from the survey:
   `node --env-file=.env .claude/skills/sml-recode-consignment/recode.cjs FROM TO --apply ITEMS TX`
   One transaction: backup → update/merge → count check → no old code left → no duplicate codes → COMMIT, else ROLLBACK.
   Backup: `data/sml-changes/backup-<time>.json`; log: `data/sml-changes/sml-changes.jsonl` (one line per changed row).
4. **Report** in Thai: rows per table, TO now has N items / with stock / qty, backup + log paths.
   For merges, remind them average cost of the target is unchanged until SML recalculates.

Several pairs in one request: survey all, show one plan, apply each pair after the single OK.
Never print `SML_WRITE_URL` or any password. Undo = restore rows from the backup JSON (ask first).
