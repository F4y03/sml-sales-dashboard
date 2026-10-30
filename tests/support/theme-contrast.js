// Runs in the browser. Inspect rendered text against its composited solid background.
// Gradients and SVG/chart text are checked in screenshots instead.
export function findContrastIssues(root = document.body) {
  const rgba = color => (color.match(/[\d.]+/g) || []).map(Number);
  const composite = (front, back) => {
    const alpha = front[3] ?? 1;
    return front.slice(0, 3).map((channel, i) => channel * alpha + back[i] * (1 - alpha));
  };
  const luminance = color => color.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const issues = [];
  for (const el of root.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement) || ['OPTION', 'SCRIPT', 'STYLE'].includes(el.tagName)
      || el.closest(':disabled,[inert]') || !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
    const label = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
    if (!label) continue;
    const layers = [];
    let hasGradient = false;
    for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.backgroundImage !== 'none' && ancestor !== document.body) { hasGradient = true; break; }
      const color = rgba(style.backgroundColor);
      layers.push(color);
      if ((color[3] ?? 1) === 1) break;
    }
    if (hasGradient) continue;
    const bg = layers.reverse().reduce((back, front) => composite(front, back), [255, 255, 255]);
    const style = getComputedStyle(el);
    const foreground = composite(rgba(style.color), bg);
    const l1 = luminance(foreground), l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) issues.push({
      element: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`,
      text: label.slice(0, 45), color: style.color, background: bg, ratio: Math.round(ratio * 100) / 100,
    });
  }
  return issues;
}
