// AI extraction tasks: each has a JSON schema (structured outputs guarantee valid JSON) and instructions.
// Input is a PDF or an image; output is structured data the browser turns into Word / Excel / CSV / HTML.

const str = { type: 'string' };
const numOrNull = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });

const SCHEMAS = {
  // PDF → Word / HTML. Flat blocks (recursive schemas are not allowed); unused fields are left empty.
  document: obj({
    title: str,
    blocks: arr(obj({
      type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'table', 'page_break'] },
      level: { type: 'integer' },          // heading level 1-3, otherwise 0
      text: str,                           // heading/paragraph text, otherwise ''
      ordered: { type: 'boolean' },        // list: numbered or bulleted
      items: arr(str),                     // list items, otherwise []
      rows: arr(arr(str)),                 // table rows (first row = header), otherwise []
    })),
  }),

  // PDF / image → Excel / CSV
  tables: obj({
    tables: arr(obj({ title: str, headers: arr(str), rows: arr(arr(str)) })),
  }),

  // Bank statement → Excel / CSV
  bank: obj({
    bank_name: str, account_holder: str, account_number: str, currency: str,
    period_start: str, period_end: str,
    opening_balance: numOrNull, closing_balance: numOrNull,
    transactions: arr(obj({ date: str, description: str, reference: str, debit: numOrNull, credit: numOrNull, balance: numOrNull })),
  }),

  // Image → translated text
  translate: obj({ detected_language: str, original_text: str, translated_text: str }),
};

const COMMON = `Work only from what is visible in the file. Never invent, guess, summarise or "correct" content.
Keep every language and script exactly as written (Bengali, English, Arabic, etc.) unless told to translate.`;

const PROMPTS = {
  document: `You convert documents into clean, editable structured content.
${COMMON}
- Output blocks in natural reading order (handle multiple columns correctly).
- Use "heading" (level 1-3) for titles and section headings, "paragraph" for body text. Join lines that belong to the same paragraph; do not break paragraphs at line wraps.
- Use "list" for bulleted or numbered lists (ordered=true for numbered). Do not repeat the bullet/number characters in the items.
- Use "table" for tables: rows is an array of rows, first row is the header, every row has the same number of cells.
- Insert a "page_break" block between pages.
- Leave out page numbers, running headers/footers repeated on every page, and watermarks.
- For unused fields use: level 0, text "", ordered false, items [], rows [].`,

  tables: `You extract tables from documents and images into spreadsheet data.
${COMMON}
- Return every table you find. A table that continues across pages with the same columns is ONE table.
- headers: the column names. rows: the data rows. Every row must have exactly as many cells as headers.
- Copy each cell exactly as shown, including currency symbols, minus signs, brackets, percent signs and thousands separators.
- For merged cells, put the value in the first cell and leave the rest as "".
- If there is no ruled table but the content is clearly tabular (aligned columns, receipts, price lists), extract it as a table.
- title: the table's caption or heading if there is one, otherwise "".
- If there are no tables at all, return an empty tables array.`,

  bank: `You extract transactions from bank statements with perfect accuracy.
${COMMON}
- Include EVERY transaction row in the order shown, across all pages. Do not include opening/closing balance lines, page totals or carried-forward lines as transactions.
- date: YYYY-MM-DD. If the year is not printed on the row, take it from the statement period.
- debit: money going out (withdrawals, payments, charges) as a positive number, otherwise null.
- credit: money coming in (deposits, transfers in, interest) as a positive number, otherwise null.
- balance: the running balance printed on that row as a number (negative if overdrawn), or null if not printed.
- Numbers: plain decimals without currency symbols or thousands separators (e.g. 12500.75).
- description: the full description text; reference: cheque/reference number if shown, otherwise "".
- currency: ISO code if identifiable (e.g. BDT, USD), otherwise "".
- opening_balance / closing_balance: as printed, or null if not printed. Unknown text fields: "".`,

  translate: (target) => `You read all text in an image and translate it.
- original_text: every piece of text in the image, transcribed exactly in reading order, keeping line breaks.
- translated_text: a natural, accurate translation of original_text into ${target}, keeping the same line breaks and structure. Keep names, numbers, codes and URLs unchanged.
- detected_language: the language name of the original text (e.g. "Bengali", "English"); "Mixed: English, Bengali" if several.
- If there is no text, all fields are "".`,
};

export const AI_TASKS = Object.keys(SCHEMAS);
export const MAX_TOKENS = { document: 64000, tables: 64000, bank: 64000, translate: 16000 };

const LANG_OK = /^[\p{L} ()-]{2,40}$/u;

/** Build the Messages API request body for a task. */
export function buildRequest({ task, data, mediaType, target, model }) {
  if (!SCHEMAS[task]) throw Object.assign(new Error('Unknown AI task.'), { status: 400 });
  let system = PROMPTS[task];
  if (task === 'translate') {
    const lang = String(target || 'English');
    if (!LANG_OK.test(lang)) throw Object.assign(new Error('Invalid target language.'), { status: 400 });
    system = PROMPTS.translate(lang);
  }
  const isPdf = mediaType === 'application/pdf';
  const source = { type: 'base64', media_type: mediaType, data };
  return {
    model,
    max_tokens: MAX_TOKENS[task],
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMAS[task] } },
    messages: [{
      role: 'user',
      content: [
        isPdf ? { type: 'document', source } : { type: 'image', source },
        { type: 'text', text: task === 'translate' ? 'Read and translate the text in this image.' : `Extract the content of this ${isPdf ? 'document' : 'image'}.` },
      ],
    }],
  };
}
