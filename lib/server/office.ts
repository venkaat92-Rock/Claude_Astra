import PptxGenJS from "pptxgenjs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import * as XLSX from "xlsx";

/**
 * Builders for the files the agent hands back to the user: PowerPoint decks,
 * Word documents and Excel workbooks. Each returns the file bytes; the tool
 * layer saves them to the workspace and offers a download link.
 */

export const MIME = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/* ------------------------------ PowerPoint ------------------------------ */

export interface SlideSpec {
  layout?: "title" | "section" | "bullets" | "two_column" | "table" | "image";
  title: string;
  subtitle?: string;
  bullets?: string[];
  left?: string[];
  right?: string[];
  table?: string[][];
  /** Image bytes resolved by the caller from a workspace path. */
  image?: { data: string; mediaType: string };
  notes?: string;
}

export interface DeckSpec {
  title?: string;
  author?: string;
  theme?: "light" | "dark" | "blue";
  slides: SlideSpec[];
}

const THEMES = {
  light: { bg: "FFFFFF", fg: "1F2328", muted: "59636E", accent: "C2410C", band: "F6F2EE" },
  dark: { bg: "15171A", fg: "E6E6E6", muted: "9AA0A6", accent: "F0883E", band: "22262B" },
  blue: { bg: "FFFFFF", fg: "0F172A", muted: "475569", accent: "1D4ED8", band: "EFF4FF" },
};

/** Bullet text may start with spaces or tabs to indent ("  - sub point"). */
function bulletRuns(items: string[], color: string): PptxGenJS.TextProps[] {
  return items.map((raw) => {
    const indent = Math.min(4, Math.floor((raw.match(/^[ \t]*/)?.[0].replace(/\t/g, "  ").length ?? 0) / 2));
    const text = raw.trim().replace(/^[-*•]\s+/, "");
    return { text, options: { bullet: true, indentLevel: indent, color, breakLine: true, paraSpaceAfter: 6 } };
  });
}

export async function buildPptx(spec: DeckSpec): Promise<Uint8Array> {
  const t = THEMES[spec.theme ?? "light"];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  if (spec.title) pptx.title = spec.title;
  if (spec.author) pptx.author = spec.author;
  const W = 13.33;
  const font = "Calibri";

  spec.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: t.bg };
    const layout = s.layout ?? (i === 0 ? "title" : s.table ? "table" : s.left || s.right ? "two_column" : s.image ? "image" : "bullets");

    if (layout === "title" || layout === "section") {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: t.accent }, line: { color: t.accent } });
      slide.addText(s.title, { x: 0.9, y: layout === "title" ? 2.4 : 2.9, w: W - 1.8, h: 1.4, fontFace: font, fontSize: layout === "title" ? 40 : 34, bold: true, color: t.fg });
      if (s.subtitle) slide.addText(s.subtitle, { x: 0.9, y: layout === "title" ? 3.9 : 4.3, w: W - 1.8, h: 1, fontFace: font, fontSize: 20, color: t.muted });
    } else {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.15, fill: { color: t.band }, line: { color: t.band } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.15, w: W, h: 0.05, fill: { color: t.accent }, line: { color: t.accent } });
      slide.addText(s.title, { x: 0.6, y: 0.15, w: W - 1.2, h: 0.85, fontFace: font, fontSize: 28, bold: true, color: t.fg, valign: "middle" });
      const top = s.subtitle ? 1.9 : 1.5;
      if (s.subtitle) slide.addText(s.subtitle, { x: 0.6, y: 1.3, w: W - 1.2, h: 0.5, fontFace: font, fontSize: 16, italic: true, color: t.muted });

      if (layout === "two_column") {
        const colW = (W - 1.6) / 2;
        if (s.left?.length) slide.addText(bulletRuns(s.left, t.fg), { x: 0.6, y: top, w: colW, h: 7 - top, fontFace: font, fontSize: 18, valign: "top" });
        if (s.right?.length) slide.addText(bulletRuns(s.right, t.fg), { x: 0.6 + colW + 0.4, y: top, w: colW, h: 7 - top, fontFace: font, fontSize: 18, valign: "top" });
      } else if (layout === "table" && s.table?.length) {
        const [head, ...body] = s.table;
        const rows: PptxGenJS.TableRow[] = [
          head.map((c) => ({ text: c, options: { bold: true, color: "FFFFFF", fill: { color: t.accent } } })),
          ...body.map((r, ri) => r.map((c) => ({ text: c, options: { color: t.fg, fill: { color: ri % 2 ? t.band : t.bg } } }))),
        ];
        slide.addTable(rows, { x: 0.6, y: top, w: W - 1.2, fontFace: font, fontSize: body.length > 10 ? 11 : 14, border: { type: "solid", pt: 0.5, color: t.muted }, autoPage: true, autoPageRepeatHeader: true });
      } else {
        const hasImage = !!s.image;
        const textW = hasImage ? (W - 1.6) * 0.55 : W - 1.2;
        if (s.bullets?.length) slide.addText(bulletRuns(s.bullets, t.fg), { x: 0.6, y: top, w: textW, h: 7 - top, fontFace: font, fontSize: s.bullets.length > 8 ? 16 : 20, valign: "top" });
        if (s.image) {
          const x = hasImage && s.bullets?.length ? 0.6 + textW + 0.4 : 1.2;
          const w = hasImage && s.bullets?.length ? W - x - 0.6 : W - 2.4;
          slide.addImage({ data: `${s.image.mediaType};base64,${s.image.data}`, x, y: top, w, h: 7 - top, sizing: { type: "contain", w, h: 7 - top } });
        }
      }
    }
    slide.addText(String(i + 1), { x: W - 1, y: 7, w: 0.6, h: 0.35, fontFace: font, fontSize: 10, color: t.muted, align: "right" });
    if (s.notes) slide.addNotes(s.notes);
  });

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return new Uint8Array(out);
}

/* ------------------------------ Word ------------------------------ */

/** Inline markdown: **bold**, *italic* / _italic_, `code`. */
function inlineRuns(text: string, base: { bold?: boolean; size?: number } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) runs.push(new TextRun({ text: tok.slice(2, -2), ...base, bold: true }));
    else if (tok.startsWith("`")) runs.push(new TextRun({ text: tok.slice(1, -1), ...base, font: "Consolas" }));
    else runs.push(new TextRun({ text: tok.slice(1, -1), ...base, italics: true }));
    last = m.index! + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...base }));
  return runs.length ? runs : [new TextRun({ text: "", ...base })];
}

function docxTable(rows: string[][]): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: cols }, (_, ci) => new TableCell({
        borders: { top: border, bottom: border, left: border, right: border },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: "EDEDED", color: "auto" } : undefined,
        children: [new Paragraph({ children: inlineRuns(r[ci] ?? "", { bold: ri === 0 }) })],
      })),
    })),
  });
}

/** Convert a markdown subset (headings, lists, tables, code, quotes, rules) to a .docx. */
export async function buildDocx(markdown: string, opts: { title?: string } = {}): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  if (opts.title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(opts.title)] }));
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let numberedInstance = 0;
  let inNumbered = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" }, children: [new TextRun({ text: lines[i] || " ", font: "Consolas", size: 19 })] }));
        i++;
      }
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) children.push(docxTable(rows), new Paragraph(""));
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const num = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (!num) inNumbered = false;
    if (h) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][h[1].length - 1];
      children.push(new Paragraph({ heading: level, children: inlineRuns(h[2]) }));
    } else if (bullet) {
      children.push(new Paragraph({ bullet: { level: Math.min(3, Math.floor(bullet[1].length / 2)) }, children: inlineRuns(bullet[2]) }));
    } else if (num) {
      if (!inNumbered) { numberedInstance++; inNumbered = true; }
      children.push(new Paragraph({ numbering: { reference: "astra-numbered", level: Math.min(3, Math.floor(num[1].length / 2)), instance: numberedInstance }, children: inlineRuns(num[2]) }));
    } else if (/^\s*>\s?/.test(line)) {
      children.push(new Paragraph({ indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "C2410C", space: 8 } }, children: inlineRuns(line.replace(/^\s*>\s?/, "")) }));
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } }, children: [] }));
    } else if (line.trim()) {
      children.push(new Paragraph({ spacing: { after: 120 }, children: inlineRuns(line.trim()) }));
    }
    i++;
  }

  const doc = new Document({
    creator: "Claude Astra",
    title: opts.title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [{
        reference: "astra-numbered",
        levels: [0, 1, 2, 3].map((level) => ({
          level,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL][level],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/* ------------------------------ Excel ------------------------------ */

export interface SheetSpec {
  name: string;
  rows: string[][];
}

/** Numeric-looking cells become numbers so formulas and sorting work in Excel. */
function cellValue(v: string): string | number | boolean {
  const s = v.trim();
  if (/^-?\d{1,15}(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  return v;
}

export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sh of sheets) {
    const aoa = sh.rows.map((r) => r.map((c) => (typeof c === "string" && c.startsWith("=") ? { f: c.slice(1) } : cellValue(String(c ?? "")))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const cols = Math.max(0, ...sh.rows.map((r) => r.length));
    ws["!cols"] = Array.from({ length: cols }, (_, ci) => ({ wch: Math.min(60, Math.max(8, ...sh.rows.map((r) => String(r[ci] ?? "").length + 2))) }));
    let name = (sh.name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
    for (let n = 2; used.has(name); n++) name = `${name.slice(0, 28)} ${n}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}
