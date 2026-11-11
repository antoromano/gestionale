// src/utils/xlsx-reader.js
// Lettore .xlsx minimale e a zero dipendenze (ZIP + XML): niente librerie da 1 MB, niente token IA.
// Funziona nei browser moderni (e in Node 18+) grazie a DecompressionStream('deflate-raw').
// Restituisce la prima foglia con dati come matrice di celle: stringhe, numeri o date ISO "YYYY-MM-DD".

const textDecoder = new TextDecoder('utf-8');

function decodeUtf8(bytes) {
  return textDecoder.decode(bytes);
}

function decodeXmlEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('File Excel non valido: archivio .xlsx non riconosciuto. Prova a salvarlo come CSV.');
  }

  const totalEntries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, view };
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Questo browser non può leggere i file .xlsx: salva il foglio come CSV e riprova.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractEntry(bytes, view, entry) {
  const lo = entry.localOffset;
  if (view.getUint32(lo, true) !== 0x04034b50) {
    throw new Error('File Excel danneggiato (intestazione locale ZIP non valida).');
  }
  const nameLength = view.getUint16(lo + 26, true);
  const extraLength = view.getUint16(lo + 28, true);
  const start = lo + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Metodo di compressione ZIP non supportato (${entry.method}).`);
}

// ---------------------------------------------------------------------------
// XML (parsing a regex: non servono DOMParser e funziona anche nei test Node)
// ---------------------------------------------------------------------------

function parseSharedStrings(xml) {
  const result = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml)) !== null) {
    const withoutPhonetic = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let text = '';
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRegex.exec(withoutPhonetic)) !== null) text += t[1];
    result.push(decodeXmlEntities(text));
  }
  return result;
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function isDateFormatCode(code) {
  const stripped = String(code)
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[dmyhs]/i.test(stripped);
}

/** Restituisce per ogni indice di stile (cellXfs) se rappresenta una data. */
function parseDateStyles(xml) {
  if (!xml) return [];
  const customFormats = new Map();
  const fmtRegex = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m;
  while ((m = fmtRegex.exec(xml)) !== null) {
    customFormats.set(Number(m[1]), decodeXmlEntities(m[2]));
  }

  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return [];
  const styles = [];
  const xfRegex = /<xf\b([^>]*?)(?:\/>|>)/g;
  while ((m = xfRegex.exec(cellXfs[1])) !== null) {
    const idMatch = m[1].match(/numFmtId="(\d+)"/);
    const id = idMatch ? Number(idMatch[1]) : 0;
    styles.push(customFormats.has(id) ? isDateFormatCode(customFormats.get(id)) : BUILTIN_DATE_FORMATS.has(id));
  }
  return styles;
}

function columnToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Numero seriale Excel -> "YYYY-MM-DD" (sistema 1900 con bug Lotus, oppure 1904). */
export function excelSerialToIso(serial, date1904 = false) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = base + Math.floor(serial) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseSheet(xml, sharedStrings, dateStyles, date1904) {
  const rows = [];
  const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cellRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2] || '';
    const ref = attrs.match(/\br="([A-Za-z]+)(\d+)"/);
    if (!ref) continue;
    const col = columnToIndex(ref[1]);
    const rowIdx = Number(ref[2]) - 1;
    const type = (attrs.match(/\bt="([^"]*)"/) || [])[1] || 'n';
    const styleIdx = Number((attrs.match(/\bs="(\d+)"/) || [])[1] || 0);

    let value = null;
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    if (type === 'inlineStr') {
      const texts = [];
      const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRegex.exec(inner)) !== null) texts.push(t[1]);
      value = decodeXmlEntities(texts.join(''));
    } else if (!v) {
      value = null;
    } else if (type === 's') {
      value = sharedStrings[Number(v[1])] ?? '';
    } else if (type === 'str') {
      value = decodeXmlEntities(v[1]);
    } else if (type === 'b') {
      value = v[1].trim() === '1' ? 'TRUE' : 'FALSE';
    } else if (type === 'e') {
      value = '';
    } else if (type === 'd') {
      value = decodeXmlEntities(v[1]).slice(0, 10);
    } else {
      const num = Number(v[1]);
      if (!Number.isFinite(num)) value = decodeXmlEntities(v[1]);
      else if (dateStyles[styleIdx] && num >= 1) value = excelSerialToIso(num, date1904);
      else value = num;
    }

    if (value === null || value === '') continue;
    if (!rows[rowIdx]) rows[rowIdx] = [];
    rows[rowIdx][col] = value;
  }

  const width = rows.reduce((max, r) => Math.max(max, r ? r.length : 0), 0);
  const dense = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) {
      dense.push(Array(width).fill(''));
      continue;
    }
    dense.push(Array.from({ length: width }, (_, c) => (r[c] === undefined ? '' : r[c])));
  }
  while (dense.length > 0 && dense[dense.length - 1].every(c => c === '')) dense.pop();
  return dense;
}

function resolveSheetPaths(workbookXml, relsXml, entryNames) {
  const rels = new Map();
  if (relsXml) {
    const relRegex = /<Relationship\b([^>]*?)\/?>/g;
    let m;
    while ((m = relRegex.exec(relsXml)) !== null) {
      const id = (m[1].match(/\bId="([^"]*)"/) || [])[1];
      const target = (m[1].match(/\bTarget="([^"]*)"/) || [])[1];
      if (id && target) rels.set(id, target);
    }
  }

  const sheets = [];
  if (workbookXml) {
    const sheetRegex = /<sheet\b([^>]*?)\/?>/g;
    let m;
    while ((m = sheetRegex.exec(workbookXml)) !== null) {
      const name = decodeXmlEntities((m[1].match(/\bname="([^"]*)"/) || [])[1] || `Foglio${sheets.length + 1}`);
      const rid = (m[1].match(/\br:id="([^"]*)"/) || [])[1];
      const target = rid ? rels.get(rid) : null;
      if (target) {
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        sheets.push({ name, path });
      }
    }
  }

  if (sheets.length === 0) {
    const fallback = entryNames
      .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10));
    fallback.forEach((path, i) => sheets.push({ name: `Foglio${i + 1}`, path }));
  }
  return sheets;
}

/**
 * Legge un file .xlsx e restituisce la prima foglia con dati.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {Promise<{sheetName: string, rows: Array<Array<string|number>>}>}
 */
export async function readXlsx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { entries, view } = readZipDirectory(bytes);

  const read = async (name) => {
    const entry = entries.get(name);
    return entry ? decodeUtf8(await extractEntry(bytes, view, entry)) : null;
  };

  const workbookXml = await read('xl/workbook.xml');
  const relsXml = await read('xl/_rels/workbook.xml.rels');
  const sharedXml = await read('xl/sharedStrings.xml');
  const stylesXml = await read('xl/styles.xml');

  const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];
  const dateStyles = parseDateStyles(stylesXml);
  const date1904 = /<workbookPr\b[^>]*date1904="(?:1|true)"/i.test(workbookXml || '');

  const sheets = resolveSheetPaths(workbookXml, relsXml, Array.from(entries.keys()));
  if (sheets.length === 0) {
    throw new Error('Nessun foglio di lavoro trovato nel file Excel.');
  }

  for (const sheet of sheets) {
    const xml = await read(sheet.path);
    if (!xml) continue;
    const rows = parseSheet(xml, sharedStrings, dateStyles, date1904);
    if (rows.length > 0) return { sheetName: sheet.name, rows };
  }
  return { sheetName: sheets[0].name, rows: [] };
}
