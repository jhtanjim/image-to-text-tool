// Builds a static version of the site into dist/ for static hosts (Vercel, Cloudflare Pages, Netlify, GitHub Pages).
// Browser-only tools work fully. Tools that need our server (Chrome, LibreOffice, AI) are shown as "Coming soon".
// Run: npm run build:static
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './public/js/tools.js';
import { renderPage } from './render.js';
import { VENDOR, VENDOR_DIRS } from './vendor.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const NM = path.join(ROOT, 'node_modules');

// Tools that cannot run without the Node server (Chromium, LibreOffice or the AI endpoint)
export const NEEDS_SERVER = new Set([
  'text-to-pdf', 'html-to-pdf', 'word-to-pdf', 'excel-to-pdf', 'ppt-to-pdf', 'word-to-jpg', 'excel-to-jpg', // Chrome / LibreOffice
  'pdf-to-word', 'pdf-to-excel', 'pdf-to-csv', 'jpg-to-excel', 'bank-statement-converter', 'image-translator', // AI (or LibreOffice)
]);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1) Static files (css, js, tools)
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// 2) Vendor libraries + pdf.js data folders
fs.mkdirSync(path.join(DIST, 'vendor'), { recursive: true });
for (const [name, rel] of Object.entries(VENDOR)) fs.copyFileSync(path.join(NM, rel), path.join(DIST, 'vendor', name));
for (const dir of VENDOR_DIRS) fs.cpSync(path.join(NM, 'pdfjs-dist', dir), path.join(DIST, 'vendor', dir), { recursive: true });

// 3) One HTML page per tool (server-only tools become "Coming soon")
for (const t of TOOLS) if (NEEDS_SERVER.has(t.slug)) t.status = 'soon';
let live = 0;
for (const t of TOOLS) {
  fs.writeFileSync(path.join(DIST, `${t.slug}.html`), renderPage(t.slug, path.join(ROOT, 'views')));
  if (t.status === 'live') live++;
}
fs.copyFileSync(path.join(DIST, 'image-to-text.html'), path.join(DIST, 'index.html'));

// 4) 404 page: send unknown addresses to the home page
fs.writeFileSync(path.join(DIST, '404.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>Not found</title><a href="/">Go to TextSnap</a>');

console.log(`Static site built in dist/: ${TOOLS.length} pages (${live} working tools, ${TOOLS.length - live} need the server and show "Coming soon").`);
