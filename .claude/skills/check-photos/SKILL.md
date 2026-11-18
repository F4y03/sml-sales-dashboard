---
name: check-photos
description: Full "ตรวจรูป" run — check Y:\Graphics\Lim (and from SAMMY Harddisk, catalogue pages) for photos of SML codes that still have no photo, put them on the brand podium background, recolour/reuse siblings, show a preview, apply after the user approves, back up to NAS and build the SKISERVER delivery. Use when the user types "ตรวจรูป", "เช็ครูป", "/check-photos" (old names: "ตรวจ lim") or asks for new photos from Lim.
---

# ตรวจรูป

Rules: `AGENTS.md` (SML read-only, never print `.env`). Reply in Thai, report progress in %. Follow the `product-images` skill for tool details; this skill is the end-to-end order the user approved on 2026-11-18.

**Never apply without showing the preview first and getting "ตกลง/ใส่เลย".**

## Checklist (copy into reply — Thai, use ✅ done · ⏳ in progress · ⬜ not started; never [x]/[ ])
```
⬜ 1. Start dashboard if not running (sml-dashboard → run-server.md)
⬜ 2. status.mjs → test-results/no-image-codes.txt (note the "before" count)
⬜ 3. Find photos
⬜ 4. Make images (podium bg / recolour / sibling reuse)
⬜ 5. Preview → wait for user approval
⬜ 6. Copy to G:, drive-ids --save (until 100%), apply.mjs (dry, then --apply)
⬜ 7. backup.mjs to NAS (background) + status.mjs "after"
⬜ 8. SKISERVER delivery
⬜ 9. Report table
```

## 3. Find photos
- `node --env-file=.env tools/product-images/match-folder.mjs "Y:\Graphics\Lim"` → look at every hit (spare-part/same-model traps in product-images skill). Lim is authoritative ([[lim-folder-authoritative]]).
- Also try `Y:\Graphics\from SAMMY Harddisk` (e.g. `PNG Cat 1\SpeakerBox2`) and catalogue pages `Y:\Graphics\Lim\Illustrator Files\11_Catalogue 2026 Edit Ver\…\JPEG`.
- **Catalogue crop** (always do this step, for every code still without a photo):
  1. Find which catalogue page shows the model: search page file names / Read pages in `Y:\Graphics\Lim\Illustrator Files\11_Catalogue 2026 Edit Ver\…\JPEG` (list results in `test-results/catalogue-pages.txt`: code → page → position). Match by model name in the SML name; check spec/colour too.
  2. Manifest item with `rect: [x, y, w, h]` in page pixels (pages 2480×3508; Read shows them scaled → multiply by the reported scale). Crop the product only — no text, price, icons or neighbouring products. Out: `<code>-C<n>.jpg`.
  3. `powershell -File tools\product-images\render.ps1 -Manifest … -Root <scratchpad>\cat\ -Whiten`, Read the contact sheet, re-crop until clean.
  4. Put the crop on the brand podium (step 4, Comp6) like any other photo. Too small/blurry (<~400 px wide) or overlapped by other items → skip and list it.
- No photo anywhere → candidates:
  - **Sibling reuse**: same product, other length/spec/colour code already has photos (e.g. 940R2-1.0 ← 940R2-1.5). Copy Drive IDs into `product_images` + `image-overrides.json`, source `"same product, other length/spec (<sib>)"`. Back up both to `data/backups/` first.
  - **Recolour**: sibling differs only by colour and the colour is a clean single hue.

## 4. Make images
- Brand backgrounds: `data/brand-bg/` (u1 MITSUMI, u2 NEW POWER, u3 PRO PLUS, u4 BEST) + `Comp6.cs`: `Add-Type -Path data\brand-bg\Comp6.cs -ReferencedAssemblies System.Drawing; [Comp6]::Run(src,bg,out,236)` (252 for white products). Brand from SML; empty brand → parent code's brand.
- Recolour: hue-selected pixel mapping only in band y 0.15–0.78 (keep logo/podium). Opaque white background → flood-fill cut (threshold 250) first. Save as `-E<n>.jpg`.
- File names: `G:\My Drive\wed\product\Lim 2026\<code>\<code>-<L|S|E><n>.jpg` (new name, never overwrite an existing Drive file).
- **Drop anything doubtful** — user rejects ⚠️ items (multi-colour parts, glue guns, transparent/metal, uneven recolour). Only offer clean results.

## 5. Preview
Build one contact sheet PNG (code + SML name under each image) in the scratchpad, Read it, show the user. Remove what they reject, then continue.

## 6–7. Apply + backup
Manifest in `test-results/<name>-manifest.json` → `drive-ids.mjs --save` → `apply.mjs <manifest> "<label>"` then `--apply` (appends). Then `node --env-file=.env tools/product-images/backup.mjs` in background, check 0 failures. Re-run status.mjs.

## 8. SKISERVER delivery
Folder `Y:\homes\sahakhun\ส่งไป SKISERVER (2026-10-22)\` — copy the newest previous round's format:
- `ชุด <YYYY-MM-DD>\product-images-delta-<date>.json` ← `node tools/product-images/export-delta.mjs <day after last round> <out>`
- `ชุด <date>\product-sheet\data\` ← current image-overrides.json, extra-products.json, hidden-codes.json (say which changed)
- `รูปใหม่ <date>\` ← new jpgs + overview png
- `ช่วยนำรูปสินค้าชุดใหม่ (<d> <เดือน> <พ.ศ.>) เข้าแดชบอร์ดบนเครื่องนี้.txt` — copy the previous txt and update: file name, code count, excluded older files, backup folder `backup-<date>`, 4 check codes, change list. Keep: dry-run first, wait for approval, don't restart server, rules section.

## 9. Report
Table: before → after no-photo count, codes per group (podium / real photo / catalogue crop / recolour / sibling), skipped + why, NAS backup result, SKISERVER folder, and that SKISERVER import is not done yet (run the txt on that machine).
