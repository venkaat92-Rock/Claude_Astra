import { z } from "zod";
import type { MediaRef } from "@/lib/types";
import { Workspace, guessContentType } from "../workspace";
import { generateImage } from "../providers/bedrock-image";
import { getVideoStatus, startVideo } from "../providers/bedrock-video";
import { modelCatalog } from "../config";
import { extractText, isBinaryText } from "../extract";
import { MIME, buildDocx, buildPptx, buildXlsx, type SlideSpec } from "../office";

/** Provider-neutral tool definition. Each provider converts `inputSchema` to its own shape. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema (object)
  /** Hint for providers that support fine-grained tool-input streaming. */
  streamInput?: boolean;
}

export interface ToolContext {
  userId: string;
  identityId: string;
  workspace: Workspace;
  signal?: AbortSignal;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  media?: MediaRef[];
}

/* ------------------------------ schemas ------------------------------ */

const ListFiles = z.object({ path: z.string().optional().describe("Directory to list, relative to the workspace root. Omit for the whole workspace.") });
const ReadFile = z.object({
  path: z.string().describe("File path relative to the workspace root."),
  offset: z.number().int().min(0).optional().describe("Character offset to start from. Long files are returned in pages of about 100k characters; pass the offset given at the end of the previous page."),
});
const WriteFile = z.object({
  path: z.string().describe("File path relative to the workspace root. Parent folders are implicit."),
  content: z.string().describe("Full file contents. Overwrites the file."),
});
const EditFile = z.object({
  path: z.string(),
  old_string: z.string().describe("Exact text to replace. Must occur exactly once unless replace_all is true."),
  new_string: z.string().describe("Replacement text."),
  replace_all: z.boolean().optional(),
});
const DeleteFile = z.object({ path: z.string() });
const SearchFiles = z.object({
  query: z.string().describe("Case-insensitive substring or regular expression to search for."),
  path: z.string().optional().describe("Restrict the search to this directory."),
  regex: z.boolean().optional(),
});
const WebFetch = z.object({ url: z.string().url().describe("http(s) URL to fetch. Returns the text content, truncated to ~40k characters.") });
const GenerateImage = z.object({
  prompt: z.string().describe("What the image should show. Be specific about subject, style, lighting."),
  negative_prompt: z.string().optional(),
  width: z.number().int().min(320).max(2048).optional(),
  height: z.number().int().min(320).max(2048).optional(),
  save_as: z.string().optional().describe("Workspace path to save the PNG to. Default: generated/<timestamp>.png"),
});
const GenerateVideo = z.object({
  prompt: z.string().describe("Describe the scene, camera motion and style."),
  model: z.enum(["nova-reel", "luma-ray-2"]).optional().describe("Video model from the catalog. Default nova-reel."),
  duration_seconds: z.number().int().optional().describe("Nova Reel: 6. Luma Ray 2: 5 or 9."),
});
const Slide = z.object({
  layout: z.enum(["title", "section", "bullets", "two_column", "table", "image"]).optional().describe("Default: title for the first slide, otherwise inferred from the fields given."),
  title: z.string(),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).optional().describe("Bullet points. Indent with two leading spaces per level for sub-bullets."),
  left: z.array(z.string()).optional().describe("two_column layout: left column bullets."),
  right: z.array(z.string()).optional().describe("two_column layout: right column bullets."),
  table: z.array(z.array(z.string())).optional().describe("table layout: rows of cells, first row is the header."),
  image_path: z.string().optional().describe("Workspace path of a PNG/JPEG to place on the slide (e.g. one made with generate_image)."),
  notes: z.string().optional().describe("Speaker notes."),
});
const CreatePptx = z.object({
  path: z.string().describe("Workspace path ending in .pptx, e.g. outputs/plan.pptx"),
  title: z.string().optional().describe("Presentation title (file metadata)."),
  theme: z.enum(["light", "dark", "blue"]).optional(),
  slides: z.array(Slide).min(1),
});
const CreateDocx = z.object({
  path: z.string().describe("Workspace path ending in .docx"),
  title: z.string().optional().describe("Document title shown at the top."),
  markdown: z.string().describe("Body in Markdown: # headings, paragraphs, - bullets, 1. numbered lists, | tables |, ``` code ```, > quotes, **bold**, *italic*."),
});
const Sheet = z.object({
  name: z.string(),
  rows: z.array(z.array(z.string())).describe("Rows of cells. Numbers are stored as numbers; a cell starting with = is a formula, e.g. =SUM(B2:B9)."),
});
const CreateXlsx = z.object({
  path: z.string().describe("Workspace path ending in .xlsx"),
  sheets: z.array(Sheet).min(1),
});
const CheckVideo = z.object({ invocation_arn: z.string().describe("The invocationArn returned by generate_video.") });

/* ------------------------------ definitions ------------------------------ */

function unwrap(t: z.ZodTypeAny): { t: z.ZodTypeAny; optional: boolean } {
  let optional = false;
  while (t instanceof z.ZodOptional || t instanceof z.ZodDefault) {
    optional = true;
    t = t._def.innerType;
  }
  return { t, optional };
}

/** Minimal zod -> JSON Schema for the shapes the tools use (objects, arrays, scalars, enums). */
function jsonSchema(raw: z.ZodTypeAny): Record<string, unknown> {
  const { t } = unwrap(raw);
  const description = raw.description ?? t.description;
  let prop: Record<string, unknown>;
  if (t instanceof z.ZodString) prop = { type: "string" };
  else if (t instanceof z.ZodNumber) prop = { type: (t as z.ZodNumber)._def.checks.some((c: { kind: string }) => c.kind === "int") ? "integer" : "number" };
  else if (t instanceof z.ZodBoolean) prop = { type: "boolean" };
  else if (t instanceof z.ZodEnum) prop = { type: "string", enum: t._def.values };
  else if (t instanceof z.ZodArray) prop = { type: "array", items: jsonSchema(t._def.type) };
  else if (t instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries((t as z.ZodObject<z.ZodRawShape>).shape)) {
      properties[key] = jsonSchema(child);
      if (!unwrap(child).optional) required.push(key);
    }
    prop = { type: "object", properties, required };
  } else prop = {};
  if (description) prop.description = description;
  return prop;
}

function schema(zt: z.ZodTypeAny): Record<string, unknown> {
  return { ...jsonSchema(zt), additionalProperties: false };
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "list_files", description: "List files in the user's workspace (S3-backed). Returns paths and sizes.", inputSchema: schema(ListFiles) },
  { name: "read_file", description: "Read a file from the workspace as text. Word (.docx), PowerPoint (.pptx), Excel (.xlsx) and PDF files are converted to text automatically. Long files come back in pages; use offset to continue.", inputSchema: schema(ReadFile) },
  { name: "write_file", description: "Create or overwrite a text file in the workspace (code, Markdown, CSV, HTML...). The user gets a download link.", inputSchema: schema(WriteFile), streamInput: true },
  { name: "create_pptx", description: "Create a PowerPoint (.pptx) deck in the workspace from a list of slides (title, bullets, two columns, tables, images, speaker notes). The user gets a download link. To change an existing deck, read it with read_file and create the revised deck.", inputSchema: schema(CreatePptx), streamInput: true },
  { name: "create_docx", description: "Create a Word (.docx) document in the workspace from Markdown (headings, lists, tables, code, quotes). The user gets a download link. To revise an existing document, read it with read_file and create the new version.", inputSchema: schema(CreateDocx), streamInput: true },
  { name: "create_xlsx", description: "Create an Excel (.xlsx) workbook in the workspace from sheets of rows. Numeric cells become numbers and cells starting with = become formulas. The user gets a download link.", inputSchema: schema(CreateXlsx), streamInput: true },
  { name: "edit_file", description: "Replace an exact string in a workspace file. Prefer this over write_file for small changes.", inputSchema: schema(EditFile), streamInput: true },
  { name: "delete_file", description: "Delete a file from the workspace.", inputSchema: schema(DeleteFile) },
  { name: "search_files", description: "Search file contents in the workspace. Returns matching lines with paths and line numbers.", inputSchema: schema(SearchFiles) },
  { name: "web_fetch", description: "Fetch a public web page or API and return its text. Use for documentation and reference material.", inputSchema: schema(WebFetch) },
  { name: "generate_image", description: "Generate an image with Amazon Nova Canvas on Bedrock and save it to the workspace. Returns the saved path and a preview URL.", inputSchema: schema(GenerateImage) },
  { name: "generate_video", description: "Start an asynchronous text-to-video job on Bedrock (Amazon Nova Reel or Luma Ray 2). Returns an invocation ARN; jobs take 2-8 minutes. Call check_video to poll.", inputSchema: schema(GenerateVideo) },
  { name: "check_video", description: "Check the status of a video job started by generate_video. When complete, returns a playable URL.", inputSchema: schema(CheckVideo) },
];

export function toolByName(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}

/* ------------------------------ executor ------------------------------ */

/** Keep each tool result small: results are replayed in every later request of the conversation. */
const READ_PAGE = 100_000;

function page(text: string, offset = 0): string {
  if (offset >= text.length && text.length > 0) return `[offset ${offset} is past the end; the file has ${text.length} characters]`;
  const chunk = text.slice(offset, offset + READ_PAGE);
  const end = offset + chunk.length;
  return end < text.length ? `${chunk}\n\n[showing characters ${offset}-${end} of ${text.length}; call read_file with offset ${end} for more, or use search_files]` : chunk;
}

/** Download link for a workspace file; the UI fetches a fresh presigned URL on click. */
function fileRef(path: string, mediaType?: string): MediaRef {
  return { kind: "file", path, name: path.split("/").pop() ?? path, mediaType: mediaType ?? guessContentType(path) };
}

function withExt(path: string, ext: string): string {
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
}

const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|csv|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|sh|sql|env|ini|cfg|xml|svg|tf|dockerfile)$/i;

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "list_files": {
        const { path } = ListFiles.parse(rawInput ?? {});
        const files = await ctx.workspace.list(path ?? "");
        if (files.length === 0) return { content: path ? `No files under ${path}/` : "Workspace is empty." };
        return { content: files.map((f) => `${f.path}\t${f.size} B`).join("\n") };
      }
      case "read_file": {
        const { path, offset } = ReadFile.parse(rawInput);
        if (/\.(docx|pptx|xlsx|xlsm|pdf)$/i.test(path)) {
          const { bytes } = await ctx.workspace.readBytes(path);
          const text = await extractText(bytes, path);
          if (text === null) return { content: `Cannot extract text from ${path}`, isError: true };
          return { content: page(text, offset) };
        }
        const { bytes } = await ctx.workspace.readBytes(path);
        if (isBinaryText(bytes)) return { content: `${path} is a binary file (${bytes.byteLength} bytes); read_file only returns text. Office documents and PDFs are converted automatically; images can be attached in the chat.`, isError: true };
        return { content: page(new TextDecoder().decode(bytes), offset) };
      }
      case "write_file": {
        const { path, content } = WriteFile.parse(rawInput);
        await ctx.workspace.write(path, content);
        return { content: `Wrote ${Buffer.byteLength(content)} bytes to ${path}`, media: [fileRef(path)] };
      }
      case "create_pptx": {
        const input = CreatePptx.parse(rawInput);
        const path = withExt(input.path, "pptx");
        const slides: SlideSpec[] = [];
        for (const s of input.slides) {
          const { image_path, ...rest } = s;
          let image: SlideSpec["image"];
          if (image_path) {
            const { bytes, contentType } = await ctx.workspace.readBytes(image_path);
            image = { data: Buffer.from(bytes).toString("base64"), mediaType: contentType?.startsWith("image/") ? contentType : guessContentType(image_path) };
          }
          slides.push({ ...rest, image });
        }
        const bytes = await buildPptx({ title: input.title, theme: input.theme, slides });
        await ctx.workspace.write(path, bytes, MIME.pptx);
        return { content: `Created ${path} (${slides.length} slides, ${bytes.byteLength} bytes). The user has a download link.`, media: [fileRef(path, MIME.pptx)] };
      }
      case "create_docx": {
        const { path: p, title, markdown } = CreateDocx.parse(rawInput);
        const path = withExt(p, "docx");
        const bytes = await buildDocx(markdown, { title });
        await ctx.workspace.write(path, bytes, MIME.docx);
        return { content: `Created ${path} (${bytes.byteLength} bytes). The user has a download link.`, media: [fileRef(path, MIME.docx)] };
      }
      case "create_xlsx": {
        const { path: p, sheets } = CreateXlsx.parse(rawInput);
        const path = withExt(p, "xlsx");
        const bytes = buildXlsx(sheets);
        await ctx.workspace.write(path, bytes, MIME.xlsx);
        return { content: `Created ${path} (${sheets.length} sheet${sheets.length === 1 ? "" : "s"}, ${bytes.byteLength} bytes). The user has a download link.`, media: [fileRef(path, MIME.xlsx)] };
      }
      case "edit_file": {
        const { path, old_string, new_string, replace_all } = EditFile.parse(rawInput);
        const current = await ctx.workspace.read(path, 4 * 1024 * 1024);
        const count = current.split(old_string).length - 1;
        if (count === 0) return { content: `old_string not found in ${path}`, isError: true };
        if (count > 1 && !replace_all) return { content: `old_string occurs ${count} times in ${path}; pass replace_all or make it unique`, isError: true };
        const next = replace_all ? current.split(old_string).join(new_string) : current.replace(old_string, () => new_string);
        await ctx.workspace.write(path, next);
        return { content: `Edited ${path} (${count} replacement${count === 1 ? "" : "s"})` };
      }
      case "delete_file": {
        const { path } = DeleteFile.parse(rawInput);
        await ctx.workspace.delete(path);
        return { content: `Deleted ${path}` };
      }
      case "search_files": {
        const { query, path, regex } = SearchFiles.parse(rawInput);
        const files = (await ctx.workspace.list(path ?? "", 300)).filter((f) => TEXT_EXT.test(f.path) && f.size < 512 * 1024);
        const re = regex ? new RegExp(query, "i") : null;
        const q = query.toLowerCase();
        const hits: string[] = [];
        for (const f of files) {
          const text = await ctx.workspace.read(f.path);
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && hits.length < 200; i++) {
            const line = lines[i];
            if (re ? re.test(line) : line.toLowerCase().includes(q)) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 300)}`);
          }
        }
        return { content: hits.length ? hits.join("\n") : "No matches." };
      }
      case "web_fetch": {
        const { url } = WebFetch.parse(rawInput);
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return { content: "Only http(s) URLs are allowed", isError: true };
        if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith(".internal")) {
          return { content: "Refusing to fetch private/internal addresses", isError: true };
        }
        const res = await fetch(url, {
          signal: AbortSignal.any([ctx.signal ?? new AbortController().signal, AbortSignal.timeout(20_000)]),
          headers: { "User-Agent": "ClaudeAstra/0.1 (+agent web_fetch)", Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
          redirect: "follow",
        });
        const ct = res.headers.get("content-type") ?? "";
        let text = await res.text();
        if (ct.includes("text/html")) text = htmlToText(text);
        if (text.length > 40_000) text = text.slice(0, 40_000) + "\n\n[truncated]";
        return { content: `HTTP ${res.status} ${ct}\n\n${text}`, isError: !res.ok };
      }
      case "generate_image": {
        const { prompt, negative_prompt, width, height, save_as } = GenerateImage.parse(rawInput);
        const canvas = modelCatalog().find((m) => m.id === "nova-canvas");
        const { png, seed } = await generateImage({ prompt, negativePrompt: negative_prompt, width, height, modelId: canvas?.apiModelId });
        const path = save_as ?? `generated/${Date.now()}.png`;
        await ctx.workspace.write(path, png, guessContentType(path));
        const url = await ctx.workspace.presign(path);
        return {
          content: `Saved image to ${path} (seed ${seed}, ${width ?? 1024}x${height ?? 1024}).`,
          media: [{ kind: "image", url, mediaType: "image/png", path }],
        };
      }
      case "generate_video": {
        const { prompt, model, duration_seconds } = GenerateVideo.parse(rawInput);
        const spec = modelCatalog().find((m) => m.id === (model ?? "nova-reel"));
        const job = await startVideo({ prompt, modelId: spec?.apiModelId, durationSeconds: duration_seconds, userId: ctx.identityId });
        return {
          content: `Started video job on ${job.modelId}.\ninvocationArn: ${job.invocationArn}\noutput: ${job.outputS3Uri}\nTypical time: 2-8 minutes. Call check_video with the invocationArn; tell the user they can also run /video status.`,
        };
      }
      case "check_video": {
        const { invocation_arn } = CheckVideo.parse(rawInput);
        const st = await getVideoStatus(invocation_arn);
        const media: MediaRef[] | undefined = st.videoUrl ? [{ kind: "video", url: st.videoUrl, mediaType: "video/mp4" }] : undefined;
        return {
          content: st.status === "Completed"
            ? `Video ready: ${st.videoUrl}`
            : st.status === "Failed"
              ? `Video job failed: ${st.failureMessage ?? "unknown error"}`
              : `Video job still ${st.status} (submitted ${st.submitTime ?? "?"}). Check again in ~60 seconds.`,
          isError: st.status === "Failed",
          media,
        };
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof z.ZodError ? `Invalid input: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : err instanceof Error ? err.message : String(err);
    return { content: message, isError: true };
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
