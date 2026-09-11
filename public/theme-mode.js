(() => {
  const key = 'prplus-theme';
  const root = document.documentElement;
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  root.dataset.theme = preference === 'light' ? 'light' : 'dark';
  const palette = () => {
    const style = getComputedStyle(root);
    return Object.fromEntries(['ink', 'muted', 'line', 'surface', 'brand'].map(name => [name, style.getPropertyValue(`--${name}`).trim()]));
  };
  function setMode(mode, persist = true) {
    root.dataset.theme = mode === 'light' ? 'light' : 'dark';
    if (persist) try { localStorage.setItem(key, root.dataset.theme); } catch {}
    document.querySelectorAll('[data-theme-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeMode === root.dataset.theme)));
    window.dispatchEvent(new Event('dashboard-theme-change'));
  }
  window.dashboardTheme = { palette, setMode };
  window.addEventListener('storage', event => { if (event.key === key) setMode(event.newValue, false); });
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.createElement('div');
    control.className = 'theme-switch';
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'โหมดการแสดงผล');
    for (const [mode, label, icon] of [['light', 'สว่าง', '☀'], ['dark', 'มืด', '☾']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.themeMode = mode;
      const symbol = document.createElement('span'); symbol.textContent = icon; symbol.setAttribute('aria-hidden', 'true');
      button.append(symbol, ` ${label}`);
      button.setAttribute('aria-pressed', String(root.dataset.theme === mode));
      button.addEventListener('click', () => setMode(mode));
      control.append(button);
    }
    const sidebar = document.querySelector('.workspace-sidebar');
    if (sidebar) sidebar.querySelector('.workspace-links').before(control);
    else document.querySelector('.form-panel')?.prepend(control);
  });
})();
