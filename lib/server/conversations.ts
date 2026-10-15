import { randomUUID } from "node:crypto";
import type { AstraMessage, ConversationRecord, ConversationSummary, Effort } from "@/lib/types";
import { INTERNAL_DIR, Workspace } from "./workspace";

/**
 * Per-user conversation store, kept in the user's S3 workspace under
 * `.astra/conversations/`. One JSON object per conversation plus an index
 * with titles and timestamps, so the chat list loads with a single read and
 * the same history is available from any device after sign-in.
 */
const INDEX_PATH = `${INTERNAL_DIR}/conversations/index.json`;
const MAX_INDEX = 500;

function bodyPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) throw new Error("Invalid conversation id");
  return `${INTERNAL_DIR}/conversations/${id}.json`;
}

export class ConversationStore {
  constructor(private ws: Workspace) {}

  async list(): Promise<ConversationSummary[]> {
    try {
      const raw = await this.ws.read(INDEX_PATH, 4 * 1024 * 1024);
      const parsed = JSON.parse(raw) as ConversationSummary[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<ConversationRecord | null> {
    try {
      return JSON.parse(await this.ws.read(bodyPath(id), 16 * 1024 * 1024)) as ConversationRecord;
    } catch {
      return null;
    }
  }

  async save(input: { id?: string; title?: string; modelId: string; messages: AstraMessage[]; effort?: Effort }): Promise<ConversationSummary> {
    const id = input.id ?? randomUUID();
    const existing = input.id ? await this.get(id) : null;
    const title = (input.title ?? existing?.title ?? deriveTitle(input.messages)).slice(0, 120);
    const record: ConversationRecord = {
      id,
      title,
      modelId: input.modelId,
      effort: input.effort,
      messages: input.messages,
      updatedAt: new Date().toISOString(),
      messageCount: input.messages.length,
    };
    await this.ws.write(bodyPath(id), JSON.stringify(record), "application/json");
    const summary: ConversationSummary = { id, title, modelId: record.modelId, updatedAt: record.updatedAt, messageCount: record.messageCount };
    const index = (await this.list()).filter((c) => c.id !== id);
    index.unshift(summary);
    await this.ws.write(INDEX_PATH, JSON.stringify(index.slice(0, MAX_INDEX)), "application/json");
    return summary;
  }

  async rename(id: string, title: string): Promise<void> {
    const rec = await this.get(id);
    if (!rec) throw new Error("Conversation not found");
    await this.save({ ...rec, title: title.trim() || rec.title });
  }

  async delete(id: string): Promise<void> {
    await this.ws.delete(bodyPath(id)).catch(() => undefined);
    const index = (await this.list()).filter((c) => c.id !== id);
    await this.ws.write(INDEX_PATH, JSON.stringify(index), "application/json");
  }
}

export function deriveTitle(messages: AstraMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.parts.find((p) => p.type === "text");
  const t = (text && "text" in text ? text.text : "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 60 ? t.slice(0, 57) + "…" : t;
  const att = first?.parts.find((p) => p.type === "image" || p.type === "document");
  return att && "name" in att && att.name ? `Attachment: ${att.name}` : "New conversation";
}
