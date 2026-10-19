import { z } from "zod";
import type { MediaRef } from "@/lib/types";
import { Workspace, guessContentType } from "../workspace";
import { generateImage } from "../providers/bedrock-image";
import { getVideoStatus, startVideo } from "../providers/bedrock-video";
import { modelCatalog } from "../config";
import { extractText, isBinaryText } from "../extract";

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
const ReadFile = z.object({ path: z.string().describe("File path relative to the workspace root.") });
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
const CheckVideo = z.object({ invocation_arn: z.string().describe("The invocationArn returned by generate_video.") });

/* ------------------------------ definitions ------------------------------ */

function schema(zt: z.ZodTypeAny): Record<string, unknown> {
  // Minimal zod -> JSON Schema for flat object schemas (what the tools above use).
  const def = (zt as z.ZodObject<z.ZodRawShape>).shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(def)) {
    let t: z.ZodTypeAny = raw;
    let optional = false;
    while (t instanceof z.ZodOptional || t instanceof z.ZodDefault) {
      optional = true;
      t = t._def.innerType;
    }
    const description = raw.description ?? t.description;
    let prop: Record<string, unknown>;
    if (t instanceof z.ZodString) prop = { type: "string" };
    else if (t instanceof z.ZodNumber) prop = { type: (t as z.ZodNumber)._def.checks.some((c: { kind: string }) => c.kind === "int") ? "integer" : "number" };
    else if (t instanceof z.ZodBoolean) prop = { type: "boolean" };
    else if (t instanceof z.ZodEnum) prop = { type: "string", enum: t._def.values };
    else prop = {};
    if (description) prop.description = description;
    properties[key] = prop;
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "list_files", description: "List files in the user's workspace (S3-backed). Returns paths and sizes.", inputSchema: schema(ListFiles) },
  { name: "read_file", description: "Read a file from the workspace as text. Word (.docx), PowerPoint (.pptx), Excel (.xlsx) and PDF files are converted to text automatically.", inputSchema: schema(ReadFile) },
  { name: "write_file", description: "Create or overwrite a file in the workspace with the given content.", inputSchema: schema(WriteFile), streamInput: true },
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
        const { path } = ReadFile.parse(rawInput);
        if (/\.(docx|pptx|xlsx|xlsm|pdf)$/i.test(path)) {
          const { bytes } = await ctx.workspace.readBytes(path);
          const text = await extractText(bytes, path);
          if (text === null) return { content: `Cannot extract text from ${path}`, isError: true };
          return { content: text.length > 512 * 1024 ? text.slice(0, 512 * 1024) + "\n\n[truncated]" : text };
        }
        const { bytes } = await ctx.workspace.readBytes(path);
        if (isBinaryText(bytes)) return { content: `${path} is a binary file (${bytes.byteLength} bytes); read_file only returns text. Office documents and PDFs are converted automatically; images can be attached in the chat.`, isError: true };
        const text = new TextDecoder().decode(bytes);
        return { content: text.length > 512 * 1024 ? text.slice(0, 512 * 1024) + `\n\n[truncated: file is ${bytes.byteLength} bytes]` : text };
      }
      case "write_file": {
        const { path, content } = WriteFile.parse(rawInput);
        await ctx.workspace.write(path, content);
        return { content: `Wrote ${Buffer.byteLength(content)} bytes to ${path}` };
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
