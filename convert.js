// Server-side converters:
//  - Chromium (via puppeteer-core): Text → PDF, HTML → PDF. Perfect text shaping for Bengali/Hindi/Arabic.
//  - LibreOffice (soffice --headless): Word / Excel / PowerPoint → PDF, keeping the original layout.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

// ---------------------------------------------------------------- program detection
const firstExisting = (list) => list.find((p) => p && fs.existsSync(p)) || null;

export const CHROME_PATH = firstExisting([
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]);

function findSoffice() {
  return firstExisting([
    process.env.SOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ]);
}
// Checked on every request, so installing LibreOffice works without restarting the server.
export const sofficePath = () => findSoffice();

export class ConvertError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---------------------------------------------------------------- network safety (SSRF protection)
// HTML/URLs come from visitors, so the server's browser must never load internal addresses
// (localhost, LAN, cloud metadata at 169.254.169.254, ...) or local files.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

const hostCache = new Map();
async function isPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !isPrivateIp(host);
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) return false;
  if (hostCache.has(host)) return hostCache.get(host);
  let ok = false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { ok = false; }
  hostCache.set(host, ok);
  setTimeout(() => hostCache.delete(host), 60_000);
  return ok;
}

// ---------------------------------------------------------------- Chromium
let browserPromise = null;
async function getBrowser() {
  if (!CHROME_PATH) throw new ConvertError('PDF engine is not available on this server (Chrome/Chromium not found).', 503);
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.connected) return b;
  }
  browserPromise = puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-dev-shm-usage',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  });
  return browserPromise;
}

async function htmlPagePdf({ html, url, pdfOptions, allowJs }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(Boolean(allowJs));
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith('about:') || u.startsWith('blob:')) return req.continue();
      return (await isPublicUrl(u)) ? req.continue() : req.abort('blockedbyclient');
    });
    if (url) {
      if (!(await isPublicUrl(url))) throw new ConvertError('That address is not allowed. Use a public http(s) website.');
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 }).catch((e) => {
        throw new ConvertError('Could not open that website: ' + e.message.split('\n')[0]);
      });
      if (res && !res.ok()) throw new ConvertError(`The website answered with an error (HTTP ${res.status()}).`);
    } else {
      await page.setContent(html, { waitUntil: 'networkidle2', timeout: 30_000 });
    }
    await page.evaluateHandle('document.fonts.ready');
    return Buffer.from(await page.pdf({ ...pdfOptions, timeout: 60_000 }));
  } finally {
    await page.close().catch(() => {});
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PAGE_FORMATS = new Set(['A4', 'Letter', 'Legal', 'A5', 'A3']);
const MARGINS = { none: '0mm', small: '12mm', normal: '20mm', large: '30mm' };
const FONT_STACKS = {
  sans: '"Segoe UI", "Nirmala UI", "Noto Sans", "Noto Sans Bengali", "Noto Sans Devanagari", "Noto Sans Arabic", "Noto Sans CJK SC", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Nirmala UI", "Noto Serif", "Noto Serif Bengali", "Noto Sans Bengali", serif',
  mono: 'Consolas, "Courier New", "Nirmala UI", "Noto Sans Mono", "Noto Sans Bengali", monospace',
};

export async function textToPdf({ text, title, fontSize, font, pageSize, margin, landscape }) {
  if (typeof text !== 'string' || !text.trim()) throw new ConvertError('Please enter some text.');
  if (text.length > 2_000_000) throw new ConvertError('Text is too long (max 2 million characters).');
  const size = Math.min(48, Math.max(8, Number(fontSize) || 12));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Document')}</title><style>
    body { font-family: ${FONT_STACKS[font] || FONT_STACKS.sans}; font-size: ${size}pt; line-height: 1.5; color: #111; margin: 0; }
    h1 { font-size: ${Math.round(size * 1.6)}pt; margin: 0 0 0.8em; }
    pre { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  </style></head><body>${title ? `<h1>${esc(title)}</h1>` : ''}<pre>${esc(text.replace(/\r\n?/g, '\n'))}</pre></body></html>`;
  const m = MARGINS[margin] || MARGINS.normal;
  return htmlPagePdf({
    html, allowJs: false,
    pdfOptions: { format: PAGE_FORMATS.has(pageSize) ? pageSize : 'A4', landscape: Boolean(landscape), printBackground: true,
      margin: { top: m, bottom: m, left: m, right: m } },
  });
}

export async function htmlToPdf({ html, url, pageSize, landscape, margin, background }) {
  if (!html && !url) throw new ConvertError('Paste some HTML, upload a file, or enter a website address.');
  if (html && html.length > 10_000_000) throw new ConvertError('HTML is too large (max 10 MB).');
  const m = MARGINS[margin] || MARGINS.small;
  return htmlPagePdf({
    html: html ? (/<meta[^>]+charset/i.test(html) ? html : `<meta charset="utf-8">${html}`) : null,
    url: url ? String(url).trim() : null,
    allowJs: Boolean(url), // websites usually need JavaScript; pasted/uploaded HTML runs without it
    pdfOptions: { format: PAGE_FORMATS.has(pageSize) ? pageSize : 'A4', landscape: Boolean(landscape), printBackground: background !== false,
      margin: { top: m, bottom: m, left: m, right: m } },
  });
}

// ---------------------------------------------------------------- LibreOffice
export const OFFICE_TYPES = {
  word: ['doc', 'docx', 'odt', 'rtf', 'txt', 'wpd'],
  excel: ['xls', 'xlsx', 'xlsm', 'ods', 'csv'],
  ppt: ['ppt', 'pptx', 'pps', 'ppsx', 'odp'],
  pdf: ['pdf'],
};
// Which output formats each input kind may be converted to
const TARGETS = { word: ['pdf', 'docx'], excel: ['pdf'], ppt: ['pdf'], pdf: ['docx'] };
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
export const mimeFor = (to) => MIME[to] || MIME.pdf;

let officeQueue = Promise.resolve(); // LibreOffice handles one conversion at a time per profile
const PROFILE_URL = pathToFileURL(path.join(os.tmpdir(), 'textsnap-lo-profile')).href;

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
  });
}

export async function officeToPdf({ buffer, fileName, kind, onePagePerSheet, to = 'pdf' }) {
  const soffice = sofficePath();
  if (!soffice) throw new ConvertError('Office conversion is not available yet on this server (LibreOffice is not installed).', 503);
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  const allowed = OFFICE_TYPES[kind];
  if (!allowed) throw new ConvertError('Unknown document type.');
  if (!TARGETS[kind].includes(to)) throw new ConvertError('That conversion is not supported.');
  if (!allowed.includes(ext)) throw new ConvertError(`Please upload a ${allowed.map((e) => '.' + e).join(', ')} file.`);
  if (!buffer?.length) throw new ConvertError('The file is empty.');

  const job = officeQueue.then(async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'textsnap-'));
    try {
      const input = path.join(dir, `input.${ext}`);
      await fsp.writeFile(input, buffer);
      const filter = to === 'docx' ? 'docx:MS Word 2007 XML'
        : kind === 'excel' && onePagePerSheet ? 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}'
        : 'pdf';
      // PDFs are opened with Writer's PDF import so they can be saved as an editable Word file
      const inFilter = kind === 'pdf' ? ['--infilter=writer_pdf_import'] : [];
      try {
        await run(soffice, [`-env:UserInstallation=${PROFILE_URL}`, '--headless', '--norestore', '--nolockcheck',
          ...inFilter, '--convert-to', filter, '--outdir', dir, input], 120_000);
      } catch (e) {
        throw new ConvertError(e.killed ? 'The conversion took too long and was stopped.' : 'This file could not be converted. It may be damaged or password-protected.', 422);
      }
      const out = path.join(dir, `input.${to}`);
      if (!fs.existsSync(out)) throw new ConvertError('This file could not be converted. It may be damaged or password-protected.', 422);
      return await fsp.readFile(out);
    } finally {
      fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
  officeQueue = job.catch(() => {}); // keep the queue going after a failure
  return job;
}
