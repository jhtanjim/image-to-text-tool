import { h, statusLine, download, canvasToBlob } from '/js/ui.js';

// Fonts with good Bengali/Hindi/Arabic coverage are listed as fallbacks so mixed text renders correctly.
const FONTS = {
  sans: '"Segoe UI", "Nirmala UI", "Noto Sans Bengali", "Noto Sans", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Nirmala UI", "Noto Serif Bengali", "Times New Roman", serif',
  mono: 'Consolas, "Courier New", "Nirmala UI", monospace',
  bangla: '"Nirmala UI", "Vrinda", "Noto Sans Bengali", "Kalpurush", sans-serif',
};

// Word-wrap text to a max width, keeping the user's own line breaks.
function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width <= maxWidth || !line.trim()) {
        // a single word longer than the line: break it by characters
        if (ctx.measureText(test).width > maxWidth && !line.trim()) {
          for (const ch of [...word]) {
            if (ctx.measureText(line + ch).width > maxWidth && line) { out.push(line); line = ''; }
            line += ch;
          }
        } else line = test;
      } else { out.push(line.trimEnd()); line = word.trimStart(); }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export default function mount(root) {
  const status = statusLine();
  const textarea = h(`<textarea class="big-text" placeholder="Type or paste your text here… (বাংলা লেখাও কাজ করে)">Hello! This text becomes an image.\nএই লেখাটি একটি ছবিতে পরিণত হবে।</textarea>`);
  const controls = h(`<div class="row">
      <label class="field">Font<select name="font"><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Monospace</option><option value="bangla">Bangla</option></select></label>
      <label class="field">Size<input type="number" name="size" min="10" max="200" value="36" /></label>
      <label class="field">Width (px)<input type="number" name="width" min="200" max="4000" value="1080" step="10" /></label>
      <label class="field">Padding<input type="number" name="pad" min="0" max="400" value="60" /></label>
      <label class="field">Line height<select name="lh"><option value="1.3">Tight</option><option value="1.55" selected>Normal</option><option value="1.9">Loose</option></select></label>
      <label class="field">Align<select name="align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label class="field">Text<input type="color" name="fg" value="#111827" /></label>
      <label class="field">Background<input type="color" name="bg" value="#ffffff" /></label>
      <label class="check field inline"><input type="checkbox" name="bold" /> Bold</label>
      <label class="check field inline"><input type="checkbox" name="transparent" /> Transparent background</label>
    </div>`);
  const preview = h('<div class="qr-preview"><canvas></canvas></div>');
  const canvas = preview.querySelector('canvas');
  const actions = h(`<div class="actions"><button class="btn primary big">Download PNG</button><button class="btn">Download JPG</button></div>`);
  const [pngBtn, jpgBtn] = actions.querySelectorAll('button');
  const val = (n) => controls.querySelector(`[name=${n}]`);

  function draw(scale = 1) {
    const size = Math.max(10, Number(val('size').value) || 36);
    const width = Math.max(200, Number(val('width').value) || 1080);
    const pad = Math.max(0, Number(val('pad').value) || 0);
    const lh = Number(val('lh').value);
    const align = val('align').value;
    const font = `${val('bold').checked ? '700' : '400'} ${size * scale}px ${FONTS[val('font').value]}`;
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    const lines = wrap(ctx, textarea.value, (width - pad * 2) * scale);
    canvas.width = width * scale;
    canvas.height = Math.ceil((lines.length * size * lh + pad * 2) * scale);
    ctx.font = font; // resizing a canvas resets its context state
    if (!val('transparent').checked) { ctx.fillStyle = val('bg').value; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.fillStyle = val('fg').value;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align;
    const x = align === 'left' ? pad * scale : align === 'right' ? (width - pad) * scale : (width / 2) * scale;
    lines.forEach((line, i) => ctx.fillText(line, x, (pad + size * lh * (i + 0.5)) * scale));
    canvas.style.width = Math.min(width, 820) + 'px';
  }

  const redraw = () => draw(1);
  textarea.addEventListener('input', redraw);
  controls.addEventListener('input', redraw);

  async function exportAs(type) {
    if (!textarea.value.trim()) return status.set('Type some text first.', true);
    draw(2); // export at 2x for sharp text
    if (type === 'image/jpeg' && val('transparent').checked) status.set('JPG has no transparency, so a white background was used.');
    let out = canvas;
    if (type === 'image/jpeg') {
      out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const c = out.getContext('2d'); c.fillStyle = val('transparent').checked ? '#ffffff' : val('bg').value;
      c.fillRect(0, 0, out.width, out.height); c.drawImage(canvas, 0, 0);
    }
    download(await canvasToBlob(out, type, 0.95), `text-image.${type === 'image/png' ? 'png' : 'jpg'}`);
    redraw();
  }
  pngBtn.onclick = () => exportAs('image/png');
  jpgBtn.onclick = () => exportAs('image/jpeg');

  root.append(textarea, controls, preview, actions, status);
  document.fonts?.ready.then(redraw);
  redraw();
}
