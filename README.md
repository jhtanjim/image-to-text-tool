---
title: TextSnap
emoji: 📄
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 5173
pinned: false
short_description: Free OCR, PDF, Word and Excel converter tools
---

# TextSnap — Free Online File Tools

A multi-tool website: OCR, PDF, Office, image and QR tools. Most tools run fully in the browser (files never leave the device).

## Tools
| Status | Tools |
|---|---|
| ✅ Live (browser) | Image to Text, Batch Image to Text, JPG to Word, PDF to Text (auto OCR for scanned pages), PDF to JPG, Image to PDF, Merge PDF, Text to Word, CSV to Excel, Excel to CSV, Invert Image, Text to Image, QR Code Generator, QR Code Scanner, Barcode Scanner |
| ✅ Live (server) | Text to PDF, HTML to PDF (Chrome/Chromium) · Word to PDF, Excel to PDF, PPT to PDF, Word to JPG, Excel to JPG (LibreOffice) |
| ✅ Live (no AI needed) | Word to Excel (exact table copy), PDF to Word "Exact layout" (LibreOffice), PDF to HTML "Simple" |
| ✅ Live (AI, needs `ANTHROPIC_API_KEY`) | PDF to Word & PDF to HTML (AI mode), PDF to Excel, PDF to CSV, JPG to Excel, Bank Statement Converter (with automatic balance checks), Image Translator |

### How the AI tools work
`ai-tasks.js` defines four tasks (`document`, `tables`, `bank`, `translate`), each with a JSON schema. The server sends the PDF/image to Claude with
structured outputs, so the answer is always valid JSON; the browser (`public/js/ai.js`) turns it into .docx / .xlsx / .csv / .html.
Bank statements are cross-checked: every printed running balance is recomputed, and opening + credits − debits must equal the closing balance; mismatches are highlighted on screen and in Excel.

## Setup
```
npm install
copy .env.example .env      # optional: add ANTHROPIC_API_KEY for AI mode
npm start
```
Open http://localhost:5173

### Server programs for document conversion
- **Chrome or Chromium** (Text/HTML → PDF): found automatically if installed.
- **LibreOffice** (Word/Excel/PPT → PDF and → JPG): install from libreoffice.org (Windows: `winget install TheDocumentFoundation.LibreOffice`).
Tools whose program is missing show a clear "not available" message; everything else keeps working.

### Deploy online
Step-by-step guide for Railway or your own server: **[DEPLOY.md](DEPLOY.md)**.

### Deploy with Docker (includes Chromium, LibreOffice and Bengali/Asian fonts)
```
docker build -t textsnap .
docker run -p 5173:5173 --env-file .env textsnap
```

### Security notes
- HTML to PDF refuses internal addresses (localhost, private networks, cloud metadata, `file://`), including images and frames inside pasted HTML.
- Pasted/uploaded HTML is rendered with JavaScript disabled. Uploads are limited to 50 MB, and conversions to `CONVERT_LIMIT_PER_HOUR` per visitor.
- LibreOffice runs one conversion at a time with a 2-minute timeout, in its own temporary folder that is deleted afterwards.

## Project structure
```
server.js              HTTP server: pages, static files, vendor libs, AI endpoint
render.js              Server-side page template (title, meta, header, tools grid)
convert.js             Server converters: Chromium (Text/HTML → PDF) and LibreOffice (Office → PDF, PDF/Word → .docx)
ai-tasks.js            AI task schemas + instructions (document, tables, bank, translate)
public/js/ai.js        AI client + builders (Word, HTML, Excel, CSV, bank balance checks)
Dockerfile             Production image with Chromium, LibreOffice and fonts
public/js/tools.js     Tool registry: add a tool here and it appears everywhere
public/js/ui.js        Shared helpers (dropzone, file list, downloads, pdf.js loader)
public/js/site.js      Theme toggle
public/tools/*.js      One file per tool
views/tools/*.html     HTML fragment for the Image to Text tool
public/css/site.css    All styles (light + dark)
```

### Adding a tool
1. Add an entry to `TOOLS` in `public/js/tools.js` (slug, name, from/to badges, title, desc, script, steps).
2. Create `public/tools/<script>.js` exporting `default function mount(root, { slug, mode })`.
3. The page is served at `/<slug>` automatically.

## Settings (.env)
| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | Enables AI high-accuracy OCR. Keep it secret; `.env` is git-ignored |
| `AI_MODEL` | `claude-opus-5-5` | Model for AI mode (`claude-haiku-5-5` is cheaper) |
| `AI_LIMIT_PER_HOUR` | `30` | AI images per visitor IP per hour |
| `PORT` | `5173` | Server port |
