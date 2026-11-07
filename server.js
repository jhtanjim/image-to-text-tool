// TextSnap server: serves the static site + POST /api/ocr-ai (Claude vision OCR).
// Run: `npm start` → http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

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
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PUBLIC_FILES = new Set(['/index.html', '/style.css', '/app.js']);

// ---- very small in-memory rate limiter (protects your API bill) ----
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now(), hour = 3600_000;
  const list = (hits.get(ip) || []).filter((t) => now - t < hour);
  if (list.length >= AI_LIMIT_PER_HOUR) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Image too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleAiOcr(req, res) {
  if (!AI_ENABLED) return sendJson(res, 503, { error: 'AI mode is not set up on this server (missing ANTHROPIC_API_KEY).' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (rateLimited(ip)) return sendJson(res, 429, { error: `AI limit reached (${AI_LIMIT_PER_HOUR} images per hour). Try again later or use Fast mode.` });

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

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (!PUBLIC_FILES.has(p)) { res.writeHead(404); return res.end('Not found'); } // never serve .env, server.js, node_modules
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/config' && req.method === 'GET') return sendJson(res, 200, { ai: AI_ENABLED, limitPerHour: AI_LIMIT_PER_HOUR });
  if (url === '/api/ocr-ai' && req.method === 'POST') return handleAiOcr(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, () => {
  console.log(`TextSnap running at http://localhost:${PORT}`);
  console.log(AI_ENABLED ? `AI mode ON (model: ${MODEL})` : 'AI mode OFF: add ANTHROPIC_API_KEY to .env to enable it');
});
