// ==============================================================================
// DOCUMENT PREPARATION FOR AI EXTRACTION
// ==============================================================================
// Turns a browser File into the request shape POST /api/rfqs/extract accepts.
//
// Supports:
// - Spreadsheets (.xlsx, .xls, .csv, .tsv) -> flattened into table rows with pipe delimiters
// - Text documents (.txt, .text, .log, .md) -> read as text
// - Word documents (.docx, .doc) -> extracted text/tables or inline data
// - PDF documents & images (.pdf, .png, .jpg, .webp) -> inline base64
// - Email messages (.eml, .msg) -> inline base64 routed to emailIngestionService
// ==============================================================================

import * as XLSX from 'xlsx';
import type { RFQExtractionRequest } from './types';

/**
 * Spreadsheet-like documents are flattened in the browser, because Gemini cannot
 * read an xlsx binary.
 */
export function isSpreadsheet(name: string): boolean {
  return /\.(xlsx|xls|csv|tsv)$/i.test(name);
}

/** A raw forwarded email (.eml or Outlook .msg) — parsed server-side by emailIngestionService. */
export function isEmailFile(name: string): boolean {
  return /\.(eml|msg)$/i.test(name);
}

/** Plain text or markdown document containing procurement lists or specs. */
export function isTextFile(name: string): boolean {
  return /\.(txt|text|log|md)$/i.test(name);
}

/** Word document (.docx or .doc). */
export function isWordDocument(name: string): boolean {
  return /\.(docx|doc)$/i.test(name);
}

/**
 * Turn a workbook into the " | "-delimited text layout the extraction prompt
 * describes, preserving row structure so quantities stay aligned with the item
 * they belong to.
 */
export function flattenWorkbook(data: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
  return workbook.SheetNames.map((sheetName) => {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: '',
    });
    const body = rows
      .map((row) => row.map((cell) => String(cell ?? '').trim()).join(' | '))
      .filter((line) => line.replace(/\|/g, '').trim() !== '')
      .join('\n');
    return `SHEET: ${sheetName}\n${body}`;
  }).join('\n\n');
}

/** Parse XML extracted from word/document.xml into structured text with line items and table rows. */
export function parseDocxXml(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/gi, '\n')
    .replace(/<w:tr[^>]*>/gi, '\n')
    .replace(/<w:tc[^>]*>/gi, ' | ')
    .replace(/<w:tab[^>]*\/>/gi, '\t')
    .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\|\s*/g, '\n')
    .replace(/\s*\|\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract text from a docx ArrayBuffer by reading the word/document.xml entry in the zip archive.
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length - 30; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      const compMethod = bytes[i + 8] | (bytes[i + 9] << 8);
      const compSize = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
      const fnLen = bytes[i + 26] | (bytes[i + 27] << 8);
      const extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
      const fnOffset = i + 30;
      if (fnOffset + fnLen <= bytes.length) {
        let fn = '';
        try {
          fn = new TextDecoder('utf-8').decode(bytes.subarray(fnOffset, fnOffset + fnLen));
        } catch {
          fn = Array.from(bytes.subarray(fnOffset, fnOffset + fnLen))
            .map((b) => String.fromCharCode(b))
            .join('');
        }
        if (fn === 'word/document.xml') {
          const dataOffset = fnOffset + fnLen + extraLen;
          const compressedData = bytes.subarray(dataOffset, dataOffset + compSize);
          if (compMethod === 0) {
            let xml = '';
            try {
              xml = new TextDecoder('utf-8').decode(compressedData);
            } catch {
              xml = Array.from(compressedData)
                .map((b) => String.fromCharCode(b))
                .join('');
            }
            return parseDocxXml(xml);
          }
          if (typeof DecompressionStream !== 'undefined') {
            try {
              const ds = new DecompressionStream('deflate-raw');
              const writer = ds.writable.getWriter();
              writer.write(compressedData);
              writer.close();
              const response = new Response(ds.readable);
              const xml = await response.text();
              if (xml) return parseDocxXml(xml);
            } catch {
              // fallback
            }
          }
        }
      }
    }
  }
  return '';
}

/** Read a file as the base64 body Gemini accepts for PDFs and images. */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      // Strip the "data:<mime>;base64," prefix the API does not expect.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Read a file as plain text string. */
export function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsText(file);
  });
}

export function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract plain text from digital PDF ArrayBuffer by reading content streams.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    if (!buffer || buffer.byteLength === 0) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 16384;
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, Array.from(slice));
    }

    const lines: string[] = [];

    const parseStreamText = (streamText: string) => {
      const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
      let match: RegExpExecArray | null;
      while ((match = tjRegex.exec(streamText)) !== null) {
        const clean = match[1]
          .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
          .replace(/\\([()\\])/g, '$1')
          .trim();
        if (clean) lines.push(clean);
      }

      const tjArrRegex = /\[(.*?)\]\s*TJ/g;
      while ((match = tjArrRegex.exec(streamText)) !== null) {
        const inner = match[1];
        const strMatches = inner.match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g);
        if (strMatches) {
          const combined = strMatches
            .map((s) =>
              s
                .slice(1, -1)
                .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
                .replace(/\\([()\\])/g, '$1')
            )
            .join(' ')
            .trim();
          if (combined) lines.push(combined);
        }
      }
    };

    const streamMarker = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let sm: RegExpExecArray | null;

    while ((sm = streamMarker.exec(binary)) !== null) {
      const rawStream = sm[1];
      if (rawStream.length > 1024 * 1024) continue; // Skip huge binary image streams
      parseStreamText(rawStream);

      if (typeof DecompressionStream !== 'undefined') {
        const streamBytes = new Uint8Array(rawStream.length);
        for (let j = 0; j < rawStream.length; j++) {
          streamBytes[j] = rawStream.charCodeAt(j);
        }
        for (const format of ['deflate', 'deflate-raw'] as const) {
          try {
            const ds = new DecompressionStream(format);
            const writer = ds.writable.getWriter();
            writer.write(streamBytes);
            writer.close();
            const resp = new Response(ds.readable);
            const decompressed = await resp.text();
            if (decompressed) {
              parseStreamText(decompressed);
              break;
            }
          } catch {
            // continue
          }
        }
      }

      if (lines.length >= 500) break; // Ample extracted lines for BOQ line items
    }

    const uniqueLines = lines.filter((l, idx) => l && lines.indexOf(l) === idx);
    return uniqueLines.join('\n').trim();
  } catch {
    return '';
  }
}

/** Build the extraction request for whichever document the buyer supplied. */
export async function buildExtractionRequest(file: File): Promise<RFQExtractionRequest> {
  if (isSpreadsheet(file.name)) {
    return { fileName: file.name, documentText: flattenWorkbook(await readAsArrayBuffer(file)) };
  }
  if (isTextFile(file.name)) {
    return { fileName: file.name, documentText: await readAsText(file) };
  }
  if (isWordDocument(file.name)) {
    try {
      const docxText = await extractDocxText(await readAsArrayBuffer(file));
      // Require a meaningful amount of recovered text before trusting a text-only
      // request. A near-empty result usually means the body is images or an
      // unusual layout, so falling back to inline data lets the model read it
      // directly rather than being handed almost nothing.
      if (docxText && docxText.trim().length >= 15) {
        return { fileName: file.name, documentText: docxText };
      }
    } catch {
      // fallback to inline data below
    }
    return {
      fileName: file.name,
      inlineData: await readAsBase64(file),
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (isEmailFile(file.name)) {
    const mimeType = /\.msg$/i.test(file.name) ? 'application/vnd.ms-outlook' : 'message/rfc822';
    return { fileName: file.name, inlineData: await readAsBase64(file), mimeType };
  }
  if (/\.pdf$/i.test(file.name)) {
    let pdfText = '';
    try {
      pdfText = await extractPdfText(await readAsArrayBuffer(file));
    } catch {
      // fallback to inline data below
    }
    return {
      fileName: file.name,
      inlineData: await readAsBase64(file),
      mimeType: file.type || 'application/pdf',
      ...(pdfText && pdfText.length >= 15 ? { documentText: pdfText } : {}),
    };
  }
  return {
    fileName: file.name,
    inlineData: await readAsBase64(file),
    // Browsers leave type empty for some uploads; PDF is the common default here.
    mimeType: file.type || 'application/pdf',
  };
}
