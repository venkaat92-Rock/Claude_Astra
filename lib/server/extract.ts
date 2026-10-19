import { unzipSync, strFromU8 } from "fflate";
import * as XLSX from "xlsx";
// pdf-parse's index runs a self-test when loaded outside a parent module; import the implementation directly.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** File types we can turn into text for the model. */
export const EXTRACTABLE_EXT = /\.(docx|pptx|xlsx|xlsm|pdf|csv|tsv|txt|md|json|ya?ml|html?)$/i;

export function isBinaryText(sample: Uint8Array): boolean {
  const n = Math.min(sample.length, 4096);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = sample[i];
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32)) suspicious++;
  }
  return n > 0 && suspicious / n > 0.1;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Word: paragraphs from word/document.xml (plus headers/footers are skipped on purpose). */
function docxText(zip: Record<string, Uint8Array>): string {
  const xml = zip["word/document.xml"];
  if (!xml) throw new Error("not a .docx (word/document.xml missing)");
  return decodeXmlEntities(
    strFromU8(xml)
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** PowerPoint: text runs per slide, in slide order. */
function pptxText(zip: Record<string, Uint8Array>): string {
  const slides = Object.keys(zip)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(/slide(\d+)/.exec(a)![1]) - Number(/slide(\d+)/.exec(b)![1]));
  if (slides.length === 0) throw new Error("not a .pptx (no slides)");
  return slides
    .map((k, i) => {
      const body = decodeXmlEntities(strFromU8(zip[k]).replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, ""))
        .replace(/\n{2,}/g, "\n").trim();
      return `--- Slide ${i + 1} ---\n${body}`;
    })
    .join("\n\n");
}

/** Excel: every sheet as CSV. */
function xlsxText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join("\n\n");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const res = await pdfParse(Buffer.from(bytes));
  return `${res.text.trim()}\n\n[${res.numpages} page${res.numpages === 1 ? "" : "s"}]`;
}

/**
 * Extract readable text from an uploaded file. Returns null for types we don't
 * handle (images, archives, executables); throws if a handled type is corrupt.
 */
export async function extractText(bytes: Uint8Array, name: string): Promise<string | null> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "docx": return docxText(unzipSync(bytes));
    case "pptx": return pptxText(unzipSync(bytes));
    case "xlsx": case "xlsm": return xlsxText(bytes);
    case "pdf": return pdfText(bytes);
    case "csv": case "tsv": case "txt": case "md": case "json": case "yaml": case "yml": case "html": case "htm":
      return new TextDecoder().decode(bytes);
    case "doc": case "ppt": case "xls":
      throw new Error(`Legacy ${ext.toUpperCase()} format is not supported; save it as .${ext}x and attach again.`);
    default:
      return null;
  }
}
