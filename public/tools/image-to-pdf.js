import { h, dropzone, fileList, statusLine, download, loadImage, canvasToBlob, loadScript, tests } from '/js/ui.js';

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] }; // points (1/72 inch)
const MARGINS = { none: 0, small: 20, big: 40 };

// JPEG EXIF orientation (1 = normal). PDF viewers ignore EXIF, so rotated phone photos must be re-drawn upright.
function jpegOrientation(buf) {
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off < v.byteLength - 4) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
      const tiff = off + 10;
      const little = v.getUint16(tiff) === 0x4949;
      const ifd = tiff + v.getUint32(tiff + 4, little);
      const n = v.getUint16(ifd, little);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + len;
  }
  return 1;
}

// Returns { bytes, kind: 'jpg'|'png', width, height } ready for pdf-lib.
async function prepareImage(file) {
  const buf = await file.arrayBuffer();
  const isJpg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (isJpg && jpegOrientation(buf) === 1) return { bytes: new Uint8Array(buf), kind: 'jpg' }; // keep original quality
  if (isPng) return { bytes: new Uint8Array(buf), kind: 'png' };
  // WEBP, GIF, BMP, or a rotated JPEG: redraw (browser applies EXIF rotation when drawing)
  const img = await loadImage(file);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return { bytes: new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.95)).arrayBuffer()), kind: 'jpg' };
}

export default function mount(root) {
  const list = fileList({ thumb: true });
  const status = statusLine();
  const options = h(`<div class="row">
      <label class="field">Page size
        <select name="size"><option value="fit">Same as image</option><option value="a4" selected>A4</option><option value="letter">US Letter</option></select>
      </label>
      <label class="field">Orientation
        <select name="orient"><option value="auto" selected>Automatic</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
      </label>
      <label class="field">Margin
        <select name="margin"><option value="none">None</option><option value="small" selected>Small</option><option value="big">Big</option></select>
      </label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Create PDF</button><button class="btn ghost" disabled>Clear all</button></div>`);
  const [createBtn, clearBtn] = actions.querySelectorAll('button');

  const dz = dropzone({
    accept: 'image/*', title: 'Drop, upload or paste images', sub: 'JPG, PNG, WEBP, GIF, BMP · drag rows to reorder pages',
    test: tests.isImage,
    onFiles: (files, skipped) => {
      list.add(files);
      status.set(skipped ? `${skipped} file(s) skipped (not an image or too large).` : `${list.items.length} image(s) added.`, !!skipped);
    },
  });
  list.onChange = (items) => { createBtn.disabled = clearBtn.disabled = !items.length; };
  clearBtn.onclick = () => { list.clear(); status.set(''); };

  createBtn.onclick = async () => {
    createBtn.disabled = true;
    try {
      await loadScript('/vendor/pdf-lib.js');
      const { PDFDocument } = window.PDFLib;
      const pdf = await PDFDocument.create();
      const size = options.querySelector('[name=size]').value;
      const orient = options.querySelector('[name=orient]').value;
      const margin = MARGINS[options.querySelector('[name=margin]').value];
      for (const [i, it] of list.items.entries()) {
        status.set(`Adding image ${i + 1} of ${list.items.length}…`);
        const prep = await prepareImage(it.file);
        const img = prep.kind === 'png' ? await pdf.embedPng(prep.bytes) : await pdf.embedJpg(prep.bytes);
        let pw, ph;
        if (size === 'fit') { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; } // 96 dpi px → pt
        else {
          [pw, ph] = PAGE_SIZES[size];
          const landscape = orient === 'landscape' || (orient === 'auto' && img.width > img.height);
          if (landscape) [pw, ph] = [ph, pw];
        }
        const page = pdf.addPage([pw, ph]);
        const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
        const w = img.width * scale, hgt = img.height * scale;
        page.drawImage(img, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
      }
      const bytes = await pdf.save();
      download(new Blob([bytes], { type: 'application/pdf' }), list.items.length === 1 ? list.items[0].file.name.replace(/\.[^.]+$/, '') + '.pdf' : 'images.pdf');
      status.set(`Done! Your PDF has ${list.items.length} page(s).`);
    } catch (err) {
      console.error(err);
      status.set('Could not create the PDF: ' + err.message, true);
    } finally { createBtn.disabled = !list.items.length; }
  };

  root.append(dz, list.el, options, actions, status);
}
