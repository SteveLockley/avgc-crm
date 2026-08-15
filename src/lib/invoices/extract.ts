// PDF text extraction. unpdf ships a build of pdf.js that runs inside
// Cloudflare Workers, so this works in the deployed Worker as well as locally.

import { extractText, getDocumentProxy } from 'unpdf';

export interface ExtractResult {
  text: string;
  pages: number;
  /** True when the PDF yielded almost no text — most likely a scan needing OCR. */
  looksScanned: boolean;
}

export async function extractPdfText(bytes: ArrayBuffer | Uint8Array): Promise<ExtractResult> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;
  const stripped = merged.replace(/\s+/g, '');
  return {
    text: merged,
    pages: totalPages,
    // A digital invoice always carries far more than this; a scan gives nearly nothing.
    looksScanned: stripped.length < 80 * Math.max(1, totalPages),
  };
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Copy into a plain ArrayBuffer so subarray views hash correctly.
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
