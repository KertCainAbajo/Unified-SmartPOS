/**
 * Prints one element on its own, in a hidden frame with the app's styles. Printing straight from a modal lets
 * the dialog's scroll area clip the document; a separate frame always prints it whole, at the top of the page.
 *
 * The element can set `data-print-width` (e.g. "80mm" for thermal receipts): the page is then exactly that wide
 * and as long as the content, like a till roll. Without it, documents print on A5.
 */
export function printElement(element: HTMLElement): void {
  const width = element.dataset.printWidth;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  // Wide enough to lay the document out at its real width, but invisible.
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width ?? '148mm'};height:10px;border:0;visibility:hidden;`;
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    window.print();
    return;
  }

  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('');
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${document.baseURI}">${styles}
    <style id="page-size">@page { size: A5; margin: 10mm; }</style>
    <style>html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body * { visibility: visible !important; }
    .print-area { position: static !important; margin: 0 auto !important; box-shadow: none !important; }</style>
    </head><body>${element.outerHTML}</body></html>`);
  doc.close();

  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
  const loaded = Promise.all(links.map((l) => (l.sheet ? Promise.resolve() : new Promise((r) => { l.onload = l.onerror = r; }))));
  void Promise.race([loaded, new Promise((r) => setTimeout(r, 1500))])
    .then(() => doc.fonts?.ready)
    .then(() => {
      if (width) {
        // Page = paper width × content height (plus a little feed), so a thermal printer cuts right after it.
        const area = doc.querySelector<HTMLElement>('.print-area');
        const mm = Math.ceil(((area?.getBoundingClientRect().height ?? 600) * 25.4) / 96) + 8;
        const size = doc.getElementById('page-size');
        if (size) size.textContent = `@page { size: ${width} ${mm}mm; margin: 0; }`;
      }
      win.focus();
      win.print();
    })
    .finally(() => setTimeout(() => frame.remove(), 1000));
}

/** Prints the printable document shown in the open dialog (or the page's only one). */
export function printDocument(): void {
  const el = document.querySelector<HTMLElement>('dialog[open] .print-area') ?? document.querySelector<HTMLElement>('.print-area');
  if (el) printElement(el);
  else window.print();
}
