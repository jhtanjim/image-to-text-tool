// TextSnap server: serves the static site + POST /api/ocr-ai (Claude vision OCR).
// Run: `npm start` → http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { renderPage } from './render.js';
import { textToPdf, htmlToPdf, officeToPdf, ConvertError, CHROME_PATH, sofficePath, mimeFor } from './convert.js';
import { AI_TASKS, buildRequest } from './ai-tasks.js';
import { VENDOR } from './vendor.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env file — use real env vars */ }

const PORT = process.env.PORT || 5173;
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const AI_LIMIT_PER_HOUR = Number(process.env.AI_LIMIT_PER_HOUR || 30); // per visitor IP
const MAX_BODY = 8 * 1024 * 1024; // 8 MB JSON (base64 image)
const AI_ENABLED = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = AI_ENABLED ? new Anthropic() : null;

const SYSTEM_PROMPT = `You are a precise OCR engine. Transcribe ALL text visible in the image exactly as written.
- Keep the original language and script (Bengali, English, Arabic, etc.). Never translate, correct or summarise.
- Preserve reading order and line breaks.
- If the image contains a table, output it as a Markdown table. Keep lists as lists.
- Output only the transcribed text, with no introduction, explanation or code fences.
- If there is no readable text, output nothing.`;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIEWS_DIR = path.join(ROOT, 'views');

// ---- very small in-memory rate limiters (protect your API bill and server CPU) ----
function makeLimiter(perHour) {
  const hits = new Map(); // ip -> [timestamps]
  return (ip) => {
    const now = Date.now(), hour = 3600_000;
    const list = (hits.get(ip) || []).filter((t) => now - t < hour);
    if (list.length >= perHour) { hits.set(ip, list); return true; }
    list.push(now); hits.set(ip, list);
    return false;
  };
}
const rateLimited = makeLimiter(AI_LIMIT_PER_HOUR);
const CONVERT_LIMIT_PER_HOUR = Number(process.env.CONVERT_LIMIT_PER_HOUR || 120);
const convertLimited = makeLimiter(CONVERT_LIMIT_PER_HOUR);
// Visitor IP for rate limits. Behind a hosting proxy (Railway, Render, nginx…) set TRUST_PROXY=1:
// the proxy appends the real client IP as the LAST X-Forwarded-For entry. Earlier entries come from the
// visitor and can be faked, so they are never used. Without TRUST_PROXY the header is ignored entirely.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const clientIp = (req) => {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress;
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, { limit = MAX_BODY, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error(`File too large (max ${Math.round(limit / 1048576)} MB)`), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { const buf = Buffer.concat(chunks); resolve(raw ? buf : buf.toString('utf8')); });
    req.on('error', reject);
  });
}

// ---- Document conversion endpoints (Chromium + LibreOffice) ----
async function handleConvert(req, res, kind, query) {
  if (convertLimited(clientIp(req))) return sendJson(res, 429, { error: `Limit reached (${CONVERT_LIMIT_PER_HOUR} conversions per hour). Please try again later.` });
  try {
    let out, name, to = 'pdf';
    if (kind === 'text-pdf' || kind === 'html-pdf') {
      const body = JSON.parse(await readBody(req, { limit: 12 * 1048576 }));
      out = kind === 'text-pdf' ? await textToPdf(body) : await htmlToPdf(body);
    } else if (kind === 'office') {
      const fileName = decodeURIComponent(req.headers['x-file-name'] || '');
      const buffer = await readBody(req, { limit: 50 * 1048576, raw: true });
      to = query.get('to') === 'docx' ? 'docx' : 'pdf';
      out = await officeToPdf({ buffer, fileName, kind: query.get('type'), onePagePerSheet: query.get('onePage') === '1', to });
      name = fileName.replace(/\.[^.]+$/, '');
    } else return sendJson(res, 404, { error: 'Unknown converter.' });
    res.writeHead(200, {
      'Content-Type': mimeFor(to),
      'Content-Length': out.length,
      ...(name ? { 'X-Output-Name': encodeURIComponent(`${name}.${to}`) } : {}),
    });
    res.end(out);
  } catch (err) {
    if (err instanceof ConvertError) return sendJson(res, err.status, { error: err.message });
    if (err.status === 413) return sendJson(res, 413, { error: err.message });
    if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'Invalid request.' });
    console.error('Conversion failed:', err);
    return sendJson(res, 500, { error: 'Conversion failed. Please try again.' });
  }
}

async function handleAiOcr(req, res) {
  if (!AI_ENABLED) return sendJson(res, 503, { error: 'AI mode is not set up on this server (missing ANTHROPIC_API_KEY).' });
  if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: `AI limit reached (${AI_LIMIT_PER_HOUR} images per hour). Try again later or use Fast mode.` });

  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return sendJson(res, e.status || 400, { error: e.status ? e.message : 'Invalid request body.' }); }

  const { image, mediaType } = payload || {};
  if (typeof image !== 'string' || !image || !ALLOWED_IMAGE_TYPES.has(mediaType)) {
    return sendJson(res, 400, { error: 'Send { image: <base64>, mediaType: image/jpeg|png|webp|gif }.' });
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // transcription doesn't need deep reasoning; keeps it fast and cheap
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if a safety classifier declines, retry on a fallback model automatically
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: 'Transcribe the text in this image.' },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return sendJson(res, 422, { error: 'The AI declined to process this image.' });
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return sendJson(res, 200, {
      text,
      truncated: response.stop_reason === 'max_tokens',
      model: response.model,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic auth failed: check ANTHROPIC_API_KEY');
      return sendJson(res, 500, { error: 'AI service is misconfigured (invalid API key).' });
    }
    if (err instanceof Anthropic.RateLimitError) return sendJson(res, 429, { error: 'AI service is busy. Please try again in a minute.' });
    if (err instanceof Anthropic.BadRequestError) {
      console.error('Bad request:', err.message);
      return sendJson(res, 400, { error: 'The AI could not read this image (unsupported or too large).' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
      return sendJson(res, 502, { error: 'AI service error. Please try again.' });
    }
    console.error(err);
    return sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

// ---- AI extraction: PDF/image → structured JSON (document blocks, tables, bank transactions, translation) ----
const AI_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
async function handleAiExtract(req, res, query) {
  if (!AI_ENABLED) return sendJson(res, 503, { error: 'AI tools are not set up on this server yet (missing ANTHROPIC_API_KEY).' });
  const task = query.get('task');
  if (!AI_TASKS.includes(task)) return sendJson(res, 400, { error: 'Unknown AI task.' });
  const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!AI_FILE_TYPES.has(mediaType)) return sendJson(res, 400, { error: 'Please upload a PDF or an image (JPG, PNG, WEBP, GIF).' });
  if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: `AI limit reached (${AI_LIMIT_PER_HOUR} files per hour). Please try again later.` });

  let request;
  try {
    const buf = await readBody(req, { limit: 24 * 1048576, raw: true }); // base64 grows ~33%; API request limit is 32 MB
    if (!buf.length) return sendJson(res, 400, { error: 'The file is empty.' });
    request = buildRequest({ task, data: buf.toString('base64'), mediaType, target: query.get('target'), model: MODEL });
  } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  try {
    // Stream so large outputs (long statements, many pages) don't hit HTTP timeouts.
    const message = await client.beta.messages.stream(request).finalMessage();
    if (message.stop_reason === 'refusal') return sendJson(res, 422, { error: 'The AI declined to process this file.' });
    if (message.stop_reason === 'max_tokens') return sendJson(res, 413, { error: 'This file has too much content to process at once. Try splitting it into smaller parts.' });
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try { data = JSON.parse(text); } catch { return sendJson(res, 502, { error: 'The AI returned an unexpected answer. Please try again.' }); }
    return sendJson(res, 200, { data, usage: { input: message.usage.input_tokens, output: message.usage.output_tokens } });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic auth failed: check ANTHROPIC_API_KEY');
      return sendJson(res, 500, { error: 'AI service is misconfigured (invalid API key).' });
    }
    if (err instanceof Anthropic.RateLimitError) return sendJson(res, 429, { error: 'AI service is busy. Please try again in a minute.' });
    if (err instanceof Anthropic.BadRequestError) {
      console.error('Bad request:', err.message);
      return sendJson(res, 400, { error: 'The AI could not read this file (too many pages, password-protected or unsupported).' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
      return sendJson(res, 502, { error: 'AI service error. Please try again.' });
    }
    console.error(err);
    return sendJson(res, 500, { error: 'Unexpected server error.' });
  }
}

function sendFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      ...(cache ? { 'Cache-Control': 'public, max-age=604800' } : {}),
    });
    res.end(data);
  });
}

function serveGet(req, res) {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }

  // Pages: "/" is Image to Text, "/<tool-slug>" is any tool
  const slug = p === '/' ? 'image-to-text' : p.slice(1).replace(/\/$/, '');
  if (/^[a-z0-9-]+$/.test(slug)) {
    const html = renderPage(slug, VIEWS_DIR);
    if (html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  }

  // Vendor libraries (whitelisted files only)
  if (p.startsWith('/vendor/')) {
    const rel = VENDOR[p.slice(8)];
    if (rel) return sendFile(res, path.join(ROOT, 'node_modules', rel), true);
    // pdf.js character maps + standard fonts (needed to render some PDFs correctly)
    const m = p.match(/^\/vendor\/(cmaps|standard_fonts)\/([\w.-]+)$/);
    if (m) return sendFile(res, path.join(ROOT, 'node_modules', 'pdfjs-dist', m[1], m[2]), true);
  }

  // Static files from /public only (never .env, server code or node_modules)
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (file.startsWith(PUBLIC_DIR + path.sep) && !p.split('/').some((seg) => seg.startsWith('.'))) {
    return sendFile(res, file, false);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/healthz') return sendJson(res, 200, { ok: true }); // for the hosting platform's health check
  if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, { ai: AI_ENABLED, limitPerHour: AI_LIMIT_PER_HOUR });
  if (url === '/api/ocr-ai' && req.method === 'POST') return handleAiOcr(req, res);
  if (url === '/api/ai/extract' && req.method === 'POST') return handleAiExtract(req, res, new URL(req.url, 'http://x').searchParams);
  if (url === '/api/convert/status' && req.method === 'GET') return sendJson(res, 200, { pdf: Boolean(CHROME_PATH), office: Boolean(sofficePath()) });
  const conv = url.match(/^\/api\/convert\/(text-pdf|html-pdf|office)$/);
  if (conv && req.method === 'POST') return handleConvert(req, res, conv[1], new URL(req.url, 'http://x').searchParams);
  if (req.method === 'GET') return serveGet(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, () => {
  console.log(`TextSnap running at http://localhost:${PORT}`);
  console.log(AI_ENABLED ? `AI mode ON (model: ${MODEL})` : 'AI mode OFF: add ANTHROPIC_API_KEY to .env to enable it');
  console.log(CHROME_PATH ? `PDF engine: ${CHROME_PATH}` : 'PDF engine OFF: install Chrome/Chromium or set CHROME_PATH');
  console.log(sofficePath() ? `Office engine: ${sofficePath()}` : 'Office engine OFF: install LibreOffice or set SOFFICE_PATH');
});
