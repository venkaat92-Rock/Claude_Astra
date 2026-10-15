import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverConfig } from "./config";

/**
 * Per-user agent workspace stored in S3 under `workspaces/{identityId}/`.
 * Every path the model supplies is normalised and confined to that prefix.
 */
/** Internal prefix (saved conversations, settings); hidden from file listings and tools. */
export const INTERNAL_DIR = ".astra";

export class Workspace {
  private s3: S3Client;
  readonly bucket: string;
  readonly prefix: string;

  constructor(identityId: string) {
    const cfg = serverConfig();
    if (!cfg.workspaceBucket) {
      throw new Error("No workspace bucket configured (ASTRA_WORKSPACE_BUCKET or Amplify storage)");
    }
    this.s3 = new S3Client({ region: cfg.region });
    this.bucket = cfg.workspaceBucket;
    this.prefix = `workspaces/${encodeURIComponent(identityId)}/`;
  }

  /** Normalise a model-supplied path; throws on traversal or empty paths. */
  key(path: string): string {
    const parts: string[] = [];
    for (const seg of path.replace(/\\/g, "/").split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") throw new Error(`Invalid path (traversal): ${path}`);
      parts.push(seg);
    }
    if (parts.length === 0) throw new Error("Path is empty");
    const rel = parts.join("/");
    if (rel.length > 512) throw new Error("Path too long");
    return this.prefix + rel;
  }

  relative(key: string): string {
    return key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
  }

  async list(dir = "", limit = 500): Promise<{ path: string; size: number; modified?: string }[]> {
    const prefix = dir ? this.key(dir) + "/" : this.prefix;
    const out: { path: string; size: number; modified?: string }[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );
      for (const o of res.Contents ?? []) {
        if (!o.Key) continue;
        const rel = this.relative(o.Key);
        if (rel === INTERNAL_DIR || rel.startsWith(INTERNAL_DIR + "/")) continue;
        out.push({ path: rel, size: o.Size ?? 0, modified: o.LastModified?.toISOString() });
        if (out.length >= limit) return out;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async read(path: string, maxBytes = 512 * 1024): Promise<string> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }));
    const bytes = await res.Body!.transformToByteArray();
    if (bytes.byteLength > maxBytes) {
      return new TextDecoder().decode(bytes.slice(0, maxBytes)) + `\n\n[truncated: file is ${bytes.byteLength} bytes]`;
    }
    return new TextDecoder().decode(bytes);
  }

  async readBytes(path: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }));
    return { bytes: await res.Body!.transformToByteArray(), contentType: res.ContentType };
  }

  async write(path: string, content: string | Uint8Array, contentType?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(path),
        Body: content,
        ContentType: contentType ?? guessContentType(path),
      }),
    );
  }

  async delete(path: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(path) }));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.read(path, 1);
      return true;
    } catch {
      return false;
    }
  }

  /** Presigned GET URL for showing generated media in the UI. */
  async presign(path: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }), { expiresIn });
  }
}

export function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "mp4": return "video/mp4";
    case "json": return "application/json";
    case "md": return "text/markdown; charset=utf-8";
    case "html": return "text/html; charset=utf-8";
    case "css": return "text/css; charset=utf-8";
    case "js": case "mjs": return "text/javascript; charset=utf-8";
    case "ts": case "tsx": case "jsx": case "py": case "txt": case "yml": case "yaml": case "toml": case "csv":
      return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

/** Presign an arbitrary S3 object (used for Bedrock video output in the media bucket). */
export async function presignS3(bucket: string, key: string, expiresIn = 3600): Promise<string> {
  const s3 = new S3Client({ region: serverConfig().region });
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}
