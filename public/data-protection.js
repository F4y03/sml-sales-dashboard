// Data Protection page: last buyer-data cleanup runs (GET /api/data-protection/cleanup), counts only.
(() => {
  const status = document.getElementById('cleanup-status');
  const table = document.getElementById('cleanup-table');
  const body = document.getElementById('cleanup-body');
  const when = at => new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const cell = text => { const td = document.createElement('td'); td.textContent = text; return td; };
  fetch('/api/data-protection/cleanup', { cache: 'no-store' })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load the cleanup log');
      const runs = data.runs || [];
      body.replaceChildren(...runs.map(r => {
        const tr = document.createElement('tr');
        tr.append(cell(when(r.at)), cell(r.error ? '—' : String(r.provinces)), cell(r.error ? '—' : String(r.logs)), cell(r.error ? 'Failed (' + r.error + ')' : 'OK'));
        return tr;
      }));
      table.hidden = !runs.length;
      status.dataset.state = runs.length ? 'ready' : 'empty';
      status.textContent = runs.length
        ? `Runs daily. Last run: ${when(runs[0].at)}. Deletes buyer data older than ${data.retentionDays} days.`
        : 'The cleanup job has not run yet. It runs at server start and then daily.';
    })
    .catch(error => {
      status.dataset.state = 'error';
      status.textContent = error instanceof TypeError ? 'Could not reach the server. Please try again.' : error.message;
    });
})();
