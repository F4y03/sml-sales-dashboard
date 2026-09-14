# Image upload checkpoint

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
