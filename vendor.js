// Browser builds of npm libraries, served at /vendor/<name> (only these exact files are exposed).
// Shared by server.js (served live) and build-static.js (copied into dist/ for static hosting).
export const VENDOR = {
  'pdf.mjs': 'pdfjs-dist/build/pdf.min.mjs',
  'pdf.worker.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
  'pdf-lib.js': 'pdf-lib/dist/pdf-lib.min.js',
  'fontkit.js': '@pdf-lib/fontkit/dist/fontkit.umd.min.js',
  'jszip.js': 'jszip/dist/jszip.min.js',
  'zxing.js': '@zxing/library/umd/index.min.js',
  'exceljs.js': 'exceljs/dist/exceljs.min.js',
  'papaparse.js': 'papaparse/papaparse.min.js',
  'docx.js': 'docx/dist/index.iife.js',
};

// pdf.js data folders (character maps + standard fonts), served at /vendor/<dir>/<file>
export const VENDOR_DIRS = ['cmaps', 'standard_fonts'];
