/**
 * Phones show list tables (`<table class="sp-cards">`) as one card per row (see index.css). Each cell then needs its
 * column name as a label; this copies the header text onto the cells as `data-label`, keeping it up to date as React
 * renders new rows. A cell can set its own `data-label` (or `data-label=""` for no label) and is left alone.
 */
function label(table: HTMLTableElement) {
  const headers: string[] = [];
  table.querySelectorAll(':scope > thead > tr:last-child > th, :scope > thead > tr:last-child > td').forEach((th) => {
    const cell = th as HTMLTableCellElement;
    for (let i = 0; i < (cell.colSpan || 1); i++) headers.push((cell.textContent ?? '').trim());
  });
  if (headers.length === 0) return;
  table.querySelectorAll(':scope > tbody > tr').forEach((row) => {
    let col = 0;
    for (const cell of Array.from((row as HTMLTableRowElement).cells)) {
      if (!cell.hasAttribute('data-label') || cell.dataset.auto === '1') {
        cell.setAttribute('data-label', cell.colSpan > 1 ? '' : headers[col] ?? '');
        cell.dataset.auto = '1';
      }
      col += cell.colSpan || 1;
    }
  });
}

export function installTableCards() {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('table.sp-cards').forEach(label);
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run); }
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
