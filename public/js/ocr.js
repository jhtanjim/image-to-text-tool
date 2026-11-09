// Shared OCR helpers (uses the global Tesseract from tesseract.js).
//
// Bengali word repair: with English+Bengali, Tesseract sometimes swaps a Bengali word for English letters
// (ক্রয়মূল্য → "FATT", "FIAT [als") and gives those words a much lower confidence than their neighbours.
// We re-read just those words (neighbouring ones together) with the Bengali-only model and keep the better answer.

let benWorker = null;
const getBenWorker = () => (benWorker ||= Tesseract.createWorker('ben', 1).then(async (w) => {
  await w.setParameters({ tessedit_pageseg_mode: '7' }); // the crop is a single line
  return w;
}));

const BN_CHARS = /[ঀ-৿]/g;
const LATIN_WORD = /^[[({"']?[A-Za-z]{2,}[\])}.,?!:;'"]?$/;

/**
 * @param {{text:string, lines:Array, input:(Blob|HTMLCanvasElement|ImageBitmap)}} result  output of a Tesseract read
 * @param {(msg:string)=>void} [onStatus]
 * @returns {Promise<string>} the repaired text
 */
export async function repairBengali(result, onStatus) {
  const lines = result.lines || [];
  // 1) find runs of low-confidence "English" words inside mostly-Bengali lines
  const groups = [];
  for (const line of lines) {
    const words = line.words || [];
    const bn = words.reduce((n, w) => n + (w.text.match(BN_CHARS) || []).length, 0);
    const latin = words.reduce((n, w) => n + (w.text.match(/[A-Za-z]/g) || []).length, 0);
    if (!bn || bn < 0.6 * (bn + latin)) continue;
    let run = null;
    for (const w of words) {
      if (LATIN_WORD.test(w.text) && w.confidence < 75) { (run ||= { line, words: [] }).words.push(w); }
      else if (run) { groups.push(run); run = null; }
    }
    if (run) groups.push(run);
  }
  if (!groups.length) return result.text;

  onStatus?.('Double-checking Bengali words…');
  const bmp = await createImageBitmap(result.input);
  const ben = await getBenWorker();
  let text = result.text;
  for (const g of groups) {
    const conf = Math.min(...g.words.map((w) => w.confidence));
    const pad = 6;
    const x0 = Math.min(...g.words.map((w) => w.bbox.x0)) - pad, y0 = Math.min(...g.words.map((w) => w.bbox.y0)) - pad;
    const x1 = Math.max(...g.words.map((w) => w.bbox.x1)) + pad, y1 = Math.max(...g.words.map((w) => w.bbox.y1)) + pad;
    const sx = Math.max(0, x0), sy = Math.max(0, y0), sw = Math.min(bmp.width, x1) - sx, sh = Math.min(bmp.height, y1) - sy;
    if (sw < 4 || sh < 4) continue;
    // small crops are zoomed ×2; big ones (high-DPI pages) are kept as they are
    const z = sh < 80 ? 2 : 1;
    const c = document.createElement('canvas');
    c.width = sw * z; c.height = sh * z;
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const { data } = await ben.recognize(c);
    const fixed = data.text.trim().replace(/\s+/g, ' ');
    const ok = (fixed.match(BN_CHARS) || []).length > 0 && !/[A-Za-z]/.test(fixed) && data.confidence >= conf + 10;
    if (!ok) continue;
    // replace the wrong span inside its own line
    const wrong = g.words.map((w) => w.text);
    const lineText = g.line.text.replace(/\n$/, '');
    const start = lineText.indexOf(wrong[0]);
    const lastIdx = lineText.indexOf(wrong[wrong.length - 1], start);
    if (start < 0 || lastIdx < 0) continue;
    const end = lastIdx + wrong[wrong.length - 1].length;
    const trail = wrong[wrong.length - 1].match(/[.,?!:;'"]$/)?.[0] || '';
    const newLine = lineText.slice(0, start) + fixed.replace(/[.,?!:;'"]$/, '') + trail + lineText.slice(end);
    text = text.replace(lineText, newLine);
    g.line.text = newLine + '\n';
  }
  bmp.close?.();
  return text;
}
