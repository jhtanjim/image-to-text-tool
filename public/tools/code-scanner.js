import { h, dropzone, statusLine, copyText, loadImage, loadScript, esc, tests } from '/js/ui.js';

const FRIENDLY = {
  QR_CODE: 'QR Code', EAN_13: 'EAN-13', EAN_8: 'EAN-8', UPC_A: 'UPC-A', UPC_E: 'UPC-E', CODE_128: 'Code 128',
  CODE_39: 'Code 39', CODE_93: 'Code 93', ITF: 'ITF', CODABAR: 'Codabar', PDF_417: 'PDF417', DATA_MATRIX: 'Data Matrix', AZTEC: 'Aztec',
};

export default function mount(root, { mode }) {
  const status = statusLine();
  const qrOnly = mode === 'qr';
  let Z, reader, hints;

  const output = h(`<div class="output-box" hidden>
      <span class="tag"></span>
      <p class="result-big"></p>
      <div class="row"><button class="btn copy">Copy</button><a class="btn primary open" target="_blank" rel="noopener noreferrer" hidden>Open link</a></div>
    </div>`);
  const camBox = h(`<div class="row"><button class="btn cam">📷 Scan with camera</button><span class="hint">Works on phones and laptops with a camera.</span></div>`);
  const video = h('<video class="camera" playsinline muted hidden></video>');
  const camBtn = camBox.querySelector('.cam');
  let camActive = false;

  async function ready() {
    await loadScript('/vendor/zxing.js');
    Z = window.ZXing;
    const formats = qrOnly ? [Z.BarcodeFormat.QR_CODE] : Object.keys(FRIENDLY).map((k) => Z.BarcodeFormat[k]);
    hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, formats], [Z.DecodeHintType.TRY_HARDER, true]]);
    reader = new Z.MultiFormatReader();
    reader.setHints(hints);
  }
  const libReady = ready();

  function show(text, format) {
    output.hidden = false;
    output.querySelector('.tag').textContent = FRIENDLY[Z.BarcodeFormat[format]] || Z.BarcodeFormat[format];
    output.querySelector('.result-big').textContent = text;
    const link = output.querySelector('.open');
    const isUrl = /^https?:\/\//i.test(text);
    link.hidden = !isUrl;
    if (isUrl) link.href = text;
  }

  // Try several versions of the image: original, resized, and inverted (for white-on-black codes).
  function decodeImage(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const sizes = [1, 1600 / Math.max(W, H), 900 / Math.max(W, H), 2].filter((s, i, a) => s > 0 && Math.max(W, H) * s <= 4000 && a.indexOf(s) === i);
    for (const invert of [false, true]) {
      for (const s of sizes) {
        const c = document.createElement('canvas');
        c.width = Math.round(W * s); c.height = Math.round(H * s);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        if (invert) ctx.filter = 'invert(1)';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        for (const Binarizer of [Z.HybridBinarizer, Z.GlobalHistogramBinarizer]) {
          try {
            const bmp = new Z.BinaryBitmap(new Binarizer(new Z.HTMLCanvasElementLuminanceSource(c)));
            return reader.decodeWithState(bmp);
          } catch { /* not found at this size; try the next variant */ }
        }
      }
    }
    return null;
  }

  const dz = dropzone({
    accept: 'image/*', multiple: false, test: tests.isImage,
    title: qrOnly ? 'Drop, upload or paste a QR code image' : 'Drop, upload or paste a barcode image',
    sub: qrOnly ? 'Screenshots and photos both work' : 'EAN, UPC, Code 128/39/93, ITF, Codabar, PDF417, Data Matrix, Aztec, QR',
    onFiles: async (files) => {
      if (!files.length) return;
      await libReady;
      status.set('Scanning…');
      try {
        const img = await loadImage(files[0]);
        const res = decodeImage(img);
        if (res) { show(res.getText(), res.getBarcodeFormat()); status.set(''); }
        else { output.hidden = true; status.set(`No ${qrOnly ? 'QR code' : 'barcode'} found. Try a sharper, closer image with the whole code visible.`, true); }
      } catch (e) { status.set('Could not read this image.', true); }
    },
  });

  camBtn.onclick = async () => {
    await libReady;
    if (camActive) return stopCam();
    try {
      const cam = new Z.BrowserMultiFormatReader(hints, 300);
      camActive = true; video.hidden = false; camBtn.textContent = '⏹ Stop camera';
      status.set('Point the camera at the code…');
      camBox.reader = cam;
      await cam.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => {
        if (res) { show(res.getText(), res.getBarcodeFormat()); status.set('Found it!'); stopCam(); }
      });
    } catch (e) {
      stopCam();
      status.set(e.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera available on this device.', true);
    }
  };
  function stopCam() {
    camBox.reader?.reset();
    camActive = false; video.hidden = true; camBtn.textContent = '📷 Scan with camera';
  }

  output.querySelector('.copy').onclick = (e) => copyText(output.querySelector('.result-big').textContent, e.currentTarget);
  root.append(dz, camBox, video, status, output);
}
