// Fallback icon for a product with no photo (or whose photo fails to load), picked from its name and
// group text. Shared by products.html (window.ProductFallbackIcons) and the consignment page.
// The markup is fixed here; product text is only matched against, never inserted as HTML.
(function (root) {
  const ICONS = {
    speaker:
      '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><circle cx="12" cy="14.5" r="4"/><circle cx="12" cy="14.5" r="1"/><circle cx="12" cy="6.5" r="1.4"/>',
    stand:
      '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M12 6.5v8M12 14.5l-6.5 7M12 14.5l6.5 7M12 14.5v7"/>',
    battery:
      '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3M7 12h5M9.5 9.5v5"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7"/>',
    amp: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="16.5" cy="12" r="2.5"/><path d="M6 10h5M6 14h5"/>',
    cable:
      '<path d="M7 3v5M11 3v5"/><rect x="5" y="8" width="8" height="5" rx="1.5"/><path d="M9 13v3a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V5"/>',
    other:
      '<path d="M3.5 7.5 12 3l8.5 4.5L12 12z"/><path d="M3.5 7.5v9L12 21l8.5-4.5v-9M12 12v9"/>',
  };
  // Order matters: "ขาไมค์" is a stand, "ตู้ลำโพง…มีไมค์" a speaker, "สายลำโพง" a cable.
  function kindOf(text) {
    const t = String(text || "");
    if (/แบต|battery/i.test(t)) return "battery";
    if (/^ขา|ขาตั้ง|ขาแขวน|stand|bracket/i.test(t)) return "stand";
    if (/^สาย|สายสัญญาณ|สายลำโพง|แจ๊ค|แจ็ค|ปลั๊ก|หัวแปลง|cable|jack|plug/i.test(t)) return "cable";
    if (/ลำโพง|ตู้|ทวิตเตอร์|ฮอร์น|speaker|tweeter|horn/i.test(t)) return "speaker";
    if (/ไมค์|ไมโครโฟน|mic/i.test(t)) return "mic";
    if (/เครื่องขยาย|แอมป์|มิกซ์|มิกเซอร์|ปรีแอมป์|amp|mixer/i.test(t)) return "amp";
    return "other";
  }
  // <span class="product-fallback-icon" data-kind=…><svg/></span>; stroke follows currentColor.
  function iconElement(text) {
    const span = document.createElement("span"),
      kind = kindOf(text);
    span.className = "product-fallback-icon";
    span.dataset.kind = kind;
    span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
    return span;
  }
  root.ProductFallbackIcons = { kindOf, iconElement };
})(typeof window !== "undefined" ? window : globalThis);
