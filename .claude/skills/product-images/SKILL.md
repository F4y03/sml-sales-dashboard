---
name: product-images
description: Add new product photos from a picture folder (NAS Y:, Google Drive G:, a zip, a catalogue) to the SML dashboard popup and the website CSV, then update the NAS photo backup. Use when the user says they have new pictures / a new folder, asks which products still have no photo, asks whether the CSV is complete, or asks to back up / re-organise all product photos.
---

# Product photos → dashboard + CSV + backup

Rules in `AGENTS.md` always apply: SML is read-only (scripts use `default_transaction_read_only=on`), never print `.env`.
Reply to the user in Thai and report progress as **%** at every step (the user asks "อัปเดต" to get it).

## Where things live
| What | Where |
|---|---|
| Dashboard popup photos | `data/access.sqlite` table `product_images` (code → links_json). Uploaded blobs in `product_image_files` |
| Website CSV photos | `product-sheet/data/image-overrides.json` (code lower-case → `{ images: [Drive IDs] }`) — **replaces** the row's photos, so always keep current photos first |
| Products added to the CSV | `product-sheet/data/extra-products.json` (`rows`) · hidden products: `hidden-codes.json` |
| CSV / photos the CSV uses | product-sheet tool `http://127.0.0.1:3002` (`/download.csv`, `/api/product-images`, cached 10 min) |
| New photo files (public, CSV links) | `G:\My Drive\wed\product\Lim 2026\<code>\` — never delete/move |
| Photo sources checked so far | `Y:\Graphics\Lim` (latest & authoritative), `Y:\Graphics\from SAMMY Harddisk`, `Y:\Graphics\Lim\Illustrator Files\11_Catalogue 2026 Edit Ver\…\JPEG` (catalogue pages), `Y:\graphic_backup\ATX-10 Die Cut`, Sales zip `งานเก่า` (old posters — not used, user undecided) |
| NAS backup of all photos | `Y:\graphic_backup\รูปสินค้าทั้งหมด (2026-10-22)\<หมวด>\<หมวดย่อย>\<รหัส - ชื่อ>\<รหัส>-01.jpg` + `ฝากขาย\<ร้าน>\…` |

Prerequisites: SSH tunnel to SML up (`scripts/start-sml-tunnel.ps1`), product-sheet on :3002, Google Drive for Desktop signed in (G:), RaiDrive (Y:).

## Workflow
Copy this checklist into your reply and tick it off:
```
- [ ] 0. Status:   node --env-file=.env tools/product-images/status.mjs
- [ ] 1. Match:    node --env-file=.env tools/product-images/match-folder.mjs "<folder>" [--all]
- [ ] 2. Choose files + write test-results/<name>-manifest.json, show the user what will go where
- [ ] 3. Render:   powershell -File tools\product-images\render.ps1 -Manifest … -Root <scratchpad>\<name>\ [-Whiten]
                   → Read the contact sheet, drop wrong/poster/box images, then copy <Root>\* into G:\My Drive\wed\product\Lim 2026
- [ ] 4. Sync:     node tools/product-images/drive-ids.mjs <manifest> --save   (repeat until 100%)
- [ ] 5. Apply:    node tools/product-images/apply.mjs <manifest> "<source label>"  then again with --apply
- [ ] 6. Backup:   node --env-file=.env tools/product-images/backup.mjs  → backup.mjs --check → verify-files.mjs "<dest>"
- [ ] 7. Re-run status.mjs; report before/after numbers, what was NOT done and why
```

### Step 1–2: matching rules (learned the hard way)
- `match-folder.mjs` only proposes. **Look at every hit.** Spare parts match the parent product's photos: voice coils 910V… ↔ speaker K-15, megaphone batteries 922BMP… ↔ megaphones, plug 911R12 ↔ speaker R-12, adapters 923A… ↔ speakers. Those are wrong — skip them.
- Same model ≠ same product: `903A4` (MITSUMI AUDIO-4 amplifier) is not the PRO PLUS A-4 mixer. Check the SML name.
- Prefer clean product shots: `Refined`, `No Reflection`, lettered sets (A, B, C…). Skip boards, rear-panel-only, packaging/boxes, manuals, social posts, mock-ups with placeholder labels, promo posters ("NEW ARRIVAL", "Back to School").
- Colour variants: give each colour its own photos when files are per colour (MP-33 Blue/Red, RM-8000 BK/BR, AH-15 white/grey).
- Products with no photo at all can use a crop of the catalogue page: manifest `rect: [x, y, w, h]` in page pixels (pages are 2480×3508; if you Read a page it is shown scaled — multiply by the scale it reports) and render with `-Whiten`.
- Same product in another colour with no photo of its own → reuse the sibling's existing Drive IDs (no upload): copy the sibling's `image-overrides.json` images (or its `/api/products/images` sheet IDs) into a new override entry with `source: "same product, other colour (<sibling>)"`, and add a `product_images` row with the same links as `https://drive.google.com/file/d/<id>/view`. Back up both files first.
- Consignment codes (ฝ + 2 letters + 3 digits + model) borrow the main code's photos only when the model part equals the main code's suffix and the names are ≥ 0.6 similar (`product-images.js`). Custom codes such as `ฝกต033แบต7.5AH` do not — match them by spec in the SML name (e.g. `12V 7.5AH` → 922BT1275) and save their own rows.
- Manifest item: `{ "code": "902UZ12", "src": "Y:/Graphics/Lim/…/UZ-12-A Refined.png", "out": "G:/My Drive/wed/product/Lim 2026/902UZ12/902UZ12-L1.jpg" }`. Use a new suffix letter per source (L = Lim, C = catalogue, S = SAMMY, G = graphic_backup…) so names never collide. Codes with `/` → use `-` in folder/file names.

### Step 5: apply
- Default = **append** after current photos (the user chose this; never replace existing photos without asking).
- `apply.mjs` backs up `access.sqlite` and `image-overrides.json` to `data/backups/` first, writes both stores in one go, caps at 20 photos.
- Dashboard shows new photos immediately; the CSV after ≤ 10 min (product-sheet cache).
- A code that is hidden or has no CSV row gets the override but will not appear in the CSV until the row exists/unhides.

### Adding products to the CSV
Missing SML codes are listed in `test-results/not-in-csv.txt` (`ซ่อน` = hidden on purpose — don't touch without asking). To add: append rows to `extra-products.json` `rows` in the same shape as existing rows (`ชนิด: simple`, name/price from SML `ic_inventory_price_formula` price_0, category/brand/box size copied from the nearest code already in the CSV, description as `• หัวข้อ : ค่า` lines). **Never invent prices** — if SML has none, ask; the user chose to hide such rows in `hidden-codes.json` with a `note` until the team sends prices.

## Progress reporting
- Render: count files in the `-Root` folder vs manifest length.
- Sync: `drive-ids.mjs` prints `x/y = %`.
- Backup: `test-results/backup-progress.txt` (`x/y = %`). Y: (WebDAV) is slow — ~4,000 photos took ~1 h. Run it in the background. If the PC loses power, just re-run (existing files are skipped), then `verify-files.mjs` to catch half-written files.

## Reporting to the user
Before/after table from `status.mjs`; list codes that got photos, codes skipped and why, what still needs the team (photos to shoot, prices, missing SKUs). Offer to update the summary file on the Desktop (`สรุปงานรูปสินค้าและ CSV (…).txt`).
