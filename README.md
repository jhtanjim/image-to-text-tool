# TextSnap — Image to Text

OCR website with two modes:
- **Fast**: free, runs in the browser with Tesseract.js (images never leave the device).
- **AI high accuracy**: the server sends the image to Claude (Anthropic API). Handles faded text, handwriting, tables and any language.

## Setup
```
npm install
copy .env.example .env      # then paste your key into .env
npm start
```
Open http://localhost:5173. Get an API key at https://console.anthropic.com (add billing credit there).
Without a key the site still works. AI mode just shows as unavailable.

## Settings (.env)
| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required for AI mode) | Your Anthropic API key. Keep it secret; `.env` is git-ignored |
| `AI_MODEL` | `claude-opus-5-5` | Model used for AI mode. `claude-haiku-5-5` is much cheaper if accuracy is good enough for you |
| `AI_LIMIT_PER_HOUR` | `30` | AI images allowed per visitor IP per hour (protects your bill) |
| `PORT` | `5173` | Server port |

## Files
- `index.html`, `style.css`, `app.js`: the website
- `server.js`: serves the site + `POST /api/ocr-ai` (Claude call) + `GET /api/config`

## Deploy
Because AI mode needs the server (to keep the API key secret), deploy to a Node host such as Render, Railway, Fly.io or a VPS, and set `ANTHROPIC_API_KEY` in the host's environment settings.
