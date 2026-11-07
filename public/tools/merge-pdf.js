import { h, dropzone, fileList, statusLine, download, loadScript, tests } from '/js/ui.js';

export default function mount(root) {
  const list = fileList();
  const status = statusLine();
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Merge PDF</button><button class="btn ghost" disabled>Clear all</button></div>`);
  const [mergeBtn, clearBtn] = actions.querySelectorAll('button');
  const libReady = loadScript('/vendor/pdf-lib.js');

  const dz = dropzone({
    accept: '.pdf,application/pdf', title: 'Drop or upload PDF files', sub: 'Add 2 or more PDFs · drag rows to change the order',
    test: tests.isPdf, paste: false, maxSizeMB: 100,
    onFiles: async (files, skipped) => {
      await libReady;
      const { PDFDocument } = window.PDFLib;
      for (const file of files) {
        try {
          const doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true });
          if (doc.isEncrypted) { status.set(`"${file.name}" is password-protected and can't be merged.`, true); continue; }
          list.add([file], () => ({ badge: 'PDF', info: `${doc.getPageCount()} page(s)` }));
        } catch { status.set(`"${file.name}" is not a valid PDF.`, true); }
      }
      if (skipped) status.set(`${skipped} file(s) skipped (not a PDF or too large).`, true);
    },
  });
  list.onChange = (items) => {
    mergeBtn.disabled = items.length < 2;
    clearBtn.disabled = !items.length;
    if (items.length === 1) status.set('Add at least one more PDF to merge.');
  };
  clearBtn.onclick = () => { list.clear(); status.set(''); };

  mergeBtn.onclick = async () => {
    mergeBtn.disabled = true;
    try {
      const { PDFDocument } = window.PDFLib;
      const out = await PDFDocument.create();
      let pages = 0;
      for (const [i, it] of list.items.entries()) {
        status.set(`Merging file ${i + 1} of ${list.items.length}…`);
        const src = await PDFDocument.load(new Uint8Array(await it.file.arrayBuffer()), { ignoreEncryption: true });
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach((p) => out.addPage(p));
        pages += copied.length;
      }
      download(new Blob([await out.save()], { type: 'application/pdf' }), 'merged.pdf');
      status.set(`Done! merged.pdf has ${pages} pages.`);
    } catch (err) {
      console.error(err);
      status.set('Could not merge: ' + err.message, true);
    } finally { mergeBtn.disabled = list.items.length < 2; }
  };

  root.append(dz, list.el, actions, status);
}
