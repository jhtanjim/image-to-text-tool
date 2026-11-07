import { h, statusLine, download, canvasToBlob, loadScript, esc } from '/js/ui.js';

// Escape special characters in Wi-Fi QR fields (\ ; , : ")
const wifiEsc = (s) => s.replace(/([\\;,:"])/g, '\\$1');

const TYPES = {
  url: { label: 'Link / URL', fields: [['url', 'Website address', 'https://example.com']],
    build: (v) => { const u = v.url.trim(); return u && !/^[a-z]+:/i.test(u) ? 'https://' + u : u; } },
  text: { label: 'Text', fields: [['text', 'Your text', 'Hello! / হ্যালো!', 'textarea']], build: (v) => v.text },
  wifi: { label: 'Wi-Fi', fields: [['ssid', 'Network name (SSID)', 'MyWiFi'], ['pass', 'Password', ''], ['enc', 'Security', 'WPA', 'select:WPA,WEP,nopass']],
    build: (v) => v.ssid ? `WIFI:T:${v.enc};S:${wifiEsc(v.ssid)};${v.enc !== 'nopass' ? `P:${wifiEsc(v.pass)};` : ''};` : '' },
  phone: { label: 'Phone', fields: [['phone', 'Phone number', '+8801XXXXXXXXX']], build: (v) => v.phone ? 'tel:' + v.phone.replace(/[^\d+]/g, '') : '' },
  email: { label: 'Email', fields: [['to', 'Email address', 'name@example.com'], ['subject', 'Subject', ''], ['body', 'Message', '', 'textarea']],
    build: (v) => { if (!v.to) return ''; const q = new URLSearchParams(); if (v.subject) q.set('subject', v.subject); if (v.body) q.set('body', v.body); const qs = q.toString().replace(/\+/g, '%20'); return `mailto:${v.to}${qs ? '?' + qs : ''}`; } },
  sms: { label: 'SMS', fields: [['phone', 'Phone number', '+8801XXXXXXXXX'], ['msg', 'Message', '', 'textarea']],
    build: (v) => v.phone ? `SMSTO:${v.phone.replace(/[^\d+]/g, '')}:${v.msg}` : '' },
};

export default function mount(root) {
  const status = statusLine();
  const typeRow = h(`<div class="row"><label class="field">QR type<select name="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select></label></div>`);
  const fieldsBox = h('<div class="row"></div>');
  const style = h(`<div class="row">
      <label class="field">Size (px)<input type="number" name="size" min="128" max="4000" value="1024" step="64" /></label>
      <label class="field">Error correction
        <select name="ec"><option value="L">Low (7%)</option><option value="M" selected>Medium (15%)</option><option value="Q">Quartile (25%)</option><option value="H">High (30%)</option></select></label>
      <label class="field">Quiet zone<select name="margin"><option value="2">Small</option><option value="4" selected>Standard</option><option value="6">Large</option></select></label>
      <label class="field">Color<input type="color" name="fg" value="#000000" /></label>
      <label class="field">Background<input type="color" name="bg" value="#ffffff" /></label>
    </div>`);
  const preview = h('<div class="qr-preview"><p class="hint">Fill in the details to create your QR code.</p></div>');
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Download PNG</button><button class="btn" disabled>Download SVG</button></div>`);
  const [pngBtn, svgBtn] = actions.querySelectorAll('button');
  let matrix = null;

  function renderFields() {
    const t = TYPES[typeRow.querySelector('select').value];
    fieldsBox.innerHTML = t.fields.map(([name, label, ph, kind]) => {
      if (kind === 'textarea') return `<label class="field" style="flex:1 1 100%">${label}<textarea name="${name}" rows="3" placeholder="${esc(ph)}"></textarea></label>`;
      if (kind?.startsWith('select:')) return `<label class="field">${label}<select name="${name}">${kind.slice(7).split(',').map((o) => `<option>${o}</option>`).join('')}</select></label>`;
      return `<label class="field" style="flex:1 1 260px">${label}<input type="text" name="${name}" placeholder="${esc(ph)}" /></label>`;
    }).join('');
    update();
  }

  const opt = (n) => style.querySelector(`[name=${n}]`).value;

  function update() {
    const t = TYPES[typeRow.querySelector('select').value];
    const values = Object.fromEntries([...fieldsBox.querySelectorAll('[name]')].map((el) => [el.name, el.value]));
    const content = t.build(values);
    const Z = window.ZXing;
    if (!content || !Z) { matrix = null; preview.innerHTML = '<p class="hint">Fill in the details to create your QR code.</p>'; pngBtn.disabled = svgBtn.disabled = true; return; }
    try {
      const hints = new Map([[Z.EncodeHintType.CHARACTER_SET, 'UTF-8']]);
      matrix = Z.QRCodeEncoder.encode(content, Z.QRCodeDecoderErrorCorrectionLevel.fromString(opt('ec')), hints).getMatrix();
      preview.innerHTML = svg();
      pngBtn.disabled = svgBtn.disabled = false;
      status.set('');
    } catch (e) {
      matrix = null; pngBtn.disabled = svgBtn.disabled = true;
      status.set('That is too much data for one QR code. Shorten the text.', true);
    }
  }

  // Crisp vector QR: one path made of 1x1 squares.
  function svg() {
    const q = Number(opt('margin')), n = matrix.getWidth(), total = n + q * 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (matrix.get(x, y) === 1) d += `M${x + q} ${y + q}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="280" height="280" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${opt('bg')}"/><path d="${d}" fill="${opt('fg')}"/></svg>`;
  }

  pngBtn.onclick = async () => {
    const q = Number(opt('margin')), n = matrix.getWidth(), total = n + q * 2;
    const size = Math.max(128, Number(opt('size')) || 1024);
    const cell = Math.max(1, Math.floor(size / total));
    const c = document.createElement('canvas');
    c.width = c.height = cell * total; // whole pixels per module = perfectly sharp
    const ctx = c.getContext('2d');
    ctx.fillStyle = opt('bg'); ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = opt('fg');
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (matrix.get(x, y) === 1) ctx.fillRect((x + q) * cell, (y + q) * cell, cell, cell);
    download(await canvasToBlob(c), 'qr-code.png');
  };
  svgBtn.onclick = () => download(new Blob([svg().replace(' width="280" height="280"', '')], { type: 'image/svg+xml' }), 'qr-code.svg');

  typeRow.addEventListener('change', renderFields);
  fieldsBox.addEventListener('input', update);
  style.addEventListener('input', update);

  root.append(h('<div class="two-col"></div>'));
  const [left, right] = [h('<div></div>'), h('<div></div>')];
  left.append(typeRow, fieldsBox, style);
  right.append(preview, actions, status);
  left.querySelectorAll('.row').forEach((r) => (r.style.marginBottom = '14px'));
  root.firstElementChild.append(left, right);
  loadScript('/vendor/zxing.js').then(renderFields);
}
