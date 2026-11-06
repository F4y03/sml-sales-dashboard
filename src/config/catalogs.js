// แคตตาล็อกสินค้า (E-Catalog): the one list of books shown on /catalog.html.
// id  -> used in the share link (catalog.html#<id>); lowercase letters, digits and "-" only.
// title -> tab label.
// pdf -> file name inside CATALOG_DIR (default data/catalogs/, outside Git). Served same-origin at /catalogs/<pdf>.
// drive (optional) -> Google Drive share link of the PDF ("Anyone with the link" can view). The server downloads it
//   into CATALOG_DIR/<pdf> (re-checked every 6 h) and serves it same-origin; no manual upload needed.
// Normally books are added on the page itself ("+ เพิ่มแคตตาล็อก", permission catalog_manage) and stored in
// CATALOG_DIR/catalogs.json. Entries here are fixed books (cannot be removed from the page), e.g.
//   { id: 'pro-audio', title: 'Pro Audio', pdf: 'pro-audio-web.pdf', drive: 'https://drive.google.com/file/d/<id>/view?usp=sharing' }
export const CATALOGS = [];
