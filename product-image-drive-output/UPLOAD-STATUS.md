# Image upload checkpoint

## Latest checkpoint, 2026-09-14 16:25 Bangkok time

954 distinct images uploaded, 600 pending. All 1,554 source images are now downloaded (the earlier 4 failures were recovered). This turn uploaded 457 images ordered by source row_index. Receipts are saved in receipts-ordered-*.json and merged into drive-upload-manifest.json after each batch.

Uploads stopped immediately on HTTP 429: "You've reached our limit of file uploads. Please try again in 3 hours." Retry approximately 19:26 Bangkok time on 2026-09-14, subject to the service confirming quota availability.

The local workbook and localhost:3002 download are verified: 1,074 rows, 48 columns, 1,148 Drive URL occurrences in the original image column, 707 source URL occurrences for pending images. All other cells match the original CSV exactly.

The Drive workbook with ID 1-aMiKMaiTT1WxGlt88ZjZAZad4rvFAGb was updated at 937 uploaded images (1,131 references), before throttling. It is 17 references behind the latest local workbook. Update this same file ID after quota returns, rather than creating another copy. Preserve pending source URLs until actual Drive URLs exist.

The notes below are historical and superseded by this checkpoint.

Destination: https://drive.google.com/drive/folders/1HmVIUErEOYkqfdksZ1ABoY8O6w-bqXip

466 distinct source URLs have completed Drive uploads; 1,084 downloaded images remain pending and 4 source images failed download earlier.
The connector returned HTTP 429 from the ChatGPT file staging service: "You've reached our limit of file uploads. Please try again in 2 hours."
Do not retry uploads until the service permits them. Stop on the first throttling error when resuming.

`drive-upload-manifest.json` contains source URL, local image path, Drive ID and returned Drive URL. Reuse completed entries; do not upload them again. `drive-folders.json` contains the existing category folder IDs.

User correction: replace URLs directly in the original image column (column AE / 31). Do not add separate Drive columns. `products-with-individual-drive-links.xlsx` now has 1,074 rows and exactly 48 columns. It replaces 547 image URL occurrences with the returned links for 466 uploaded images, retaining source URLs for pending images and all other cell values exactly. Preserve multiple image URLs and their order in the same cell.

The workbook is local only: file-upload throttling prevents uploading this new Excel to Drive as well. Older Excel files already in Drive do not contain this partial Drive-link mapping.

The product-sheet server loads this workbook on each request. The API serves 48 columns and the download endpoint serves this workbook. The client renders multiple URLs in a cell as separate clickable links.

Resume with small batches and save checkpoints between batches. Before uploading any pending image, check for an existing file with the same name in the assigned folder: an interrupted early request may have completed remotely without a saved response.

Regenerate with `tools/build-drive-image-workbook.ps1` and validate with `node tools/verify-drive-workbook.mjs`. After all uploads complete, upload the final Excel to the destination folder.
