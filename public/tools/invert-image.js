import { h, dropzone, statusLine, download, loadImage, canvasToBlob, loadScript, baseName, tests } from '/js/ui.js';

export default function mount(root) {
  const status = statusLine();
  const grid = h('<div class="preview-grid"></div>');
  const actions = h(`<div class="actions"><button class="btn primary" disabled>Download all (ZIP)</button><button class="btn ghost" disabled>Clear all</button></div>`);
  const [zipBtn, clearBtn] = actions.querySelectorAll('button');
  let results = []; // { name, blob, url }

  async function invert(file) {
    const img = await loadImage(file);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) { px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2]; } // alpha kept
    ctx.putImageData(data, 0, 0);
    const jpg = file.type === 'image/jpeg';
    const blob = await canvasToBlob(c, jpg ? 'image/jpeg' : 'image/png', 0.95);
    return { name: `${baseName(file.name)}-inverted.${jpg ? 'jpg' : 'png'}`, blob, url: URL.createObjectURL(blob) };
  }

  const dz = dropzone({
    accept: 'image/*', title: 'Drop, upload or paste images', sub: 'Colors are inverted instantly in your browser', test: tests.isImage,
    onFiles: async (files, skipped) => {
      for (const [i, f] of files.entries()) {
        status.set(`Inverting ${i + 1} of ${files.length}…`);
        try {
          const r = await invert(f);
          results.push(r);
          const card = h(`<div class="preview"><img alt="" src="${r.url}" /><div class="cap"><span title="${r.name}">${r.name}</span><button class="btn sm">Download</button></div></div>`);
          card.querySelector('button').onclick = () => download(r.blob, r.name);
          grid.appendChild(card);
        } catch (e) { status.set(`Could not read ${f.name}.`, true); }
      }
      zipBtn.disabled = clearBtn.disabled = !results.length;
      status.set(skipped ? `${skipped} file(s) skipped.` : `Done! ${results.length} image(s) inverted.`, !!skipped);
    },
  });

  zipBtn.onclick = async () => {
    await loadScript('/vendor/jszip.js');
    const zip = new window.JSZip();
    results.forEach((r) => zip.file(r.name, r.blob));
    download(await zip.generateAsync({ type: 'blob' }), 'inverted-images.zip');
  };
  clearBtn.onclick = () => {
    results.forEach((r) => URL.revokeObjectURL(r.url));
    results = []; grid.innerHTML = ''; zipBtn.disabled = clearBtn.disabled = true; status.set('');
  };

  root.append(dz, actions, status, grid);
}
