// Product image link rules, shared by the browser (window.ProductImageLinks) and the server
// (src/services/productImages.js evaluates this same file), so both accept exactly the same links.
(function (root) {
  const MAX_LENGTH = 1000;
  const DRIVE_ID = /^[\w-]{20,100}$/;
  // Photos uploaded to this app are stored by id and linked by this same-origin path.
  const UPLOADED = /^\/api\/products\/images\/files\/([a-f0-9]{32})$/;
  const THUMB_WIDTH = 320;
  const driveFile = (id) => `https://drive.google.com/file/d/${id}/view`;
  // Returns { ok: true, value, driveId[, fileId] } or { ok: false, reason: "empty" | "folder" | "invalid" }.
  function normalizeImageLink(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return { ok: false, reason: "empty" };
    if (text.length > MAX_LENGTH) return { ok: false, reason: "invalid" };
    const fileId = text.match(UPLOADED)?.[1];
    if (fileId) return { ok: true, value: text, driveId: null, fileId };
    if (DRIVE_ID.test(text)) return { ok: true, value: driveFile(text), driveId: text };
    let url;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    if (url.protocol !== "https:") return { ok: false, reason: "invalid" };
    const host = url.hostname.toLowerCase();
    if (host === "drive.google.com" || host === "docs.google.com") {
      if (/\/folders\//.test(url.pathname) || url.pathname.startsWith("/folderview"))
        return { ok: false, reason: "folder" };
      const fromPath = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1];
      const fromQuery = /^\/(open|uc|thumbnail)$/.test(url.pathname) ? url.searchParams.get("id") : null;
      const id = fromPath || fromQuery;
      if (id && DRIVE_ID.test(id)) return { ok: true, value: driveFile(id), driveId: id };
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, value: url.href, driveId: null };
  }
  // Image source for display: Drive files go through the thumbnail endpoint at the requested width;
  // uploaded photos use their small stored copy for widths up to THUMB_WIDTH.
  function imageSource(link, width = 1200) {
    const result = normalizeImageLink(link);
    if (!result.ok) return "";
    if (result.fileId) return width <= THUMB_WIDTH ? result.value + "?size=thumb" : result.value;
    return result.driveId
      ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(result.driveId)}&sz=w${width}`
      : result.value;
  }
  root.ProductImageLinks = { MAX_LENGTH, MAX_IMAGES: 20, THUMB_WIDTH, normalizeImageLink, imageSource };
})(typeof window !== "undefined" ? window : globalThis);
