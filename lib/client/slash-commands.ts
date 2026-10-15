import type { Effort } from "@/lib/types";

export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show commands and keyboard shortcuts" },
  { name: "model", args: "[id]", description: "Show or switch the active model" },
  { name: "models", description: "List available models and why some are unavailable" },
  { name: "effort", args: "<low|medium|high|xhigh|max>", description: "Set reasoning effort (Claude)" },
  { name: "image", args: "<prompt>", description: "Generate an image with Amazon Nova Canvas" },
  { name: "video", args: "<prompt> | status <arn>", description: "Start a Nova Reel / Luma video job, or poll one" },
  { name: "files", description: "List workspace files" },
  { name: "cat", args: "<path>", description: "Print a workspace file" },
  { name: "agent", description: "Switch to the configured Bedrock Agent" },
  { name: "theme", description: "Toggle light / dark" },
  { name: "clear", description: "Start a new chat (the current one stays in the list)" },
  { name: "new", description: "Alias for /clear" },
];

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function parseSlash(input: string): { name: string; rest: string } | null {
  const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), rest: (m[2] ?? "").trim() };
}

export const HELP_TEXT = `Claude Astra — commands
${SLASH_COMMANDS.map((c) => `  /${c.name}${c.args ? " " + c.args : ""}`.padEnd(36) + c.description).join("\n")}

Keys
  Enter        send        Shift+Enter  newline
  Esc          stop the current run
  ↑ / ↓        navigate slash-command suggestions

Attach files with the paperclip, by dragging them onto the prompt, or by pasting.
Images and PDFs go to the model directly; other files land in your workspace.
Chats are saved to your cloud workspace and listed on the left.

The agent can read/write files in your workspace (right panel), fetch docs,
and generate images/videos. It cannot run shell commands; it will tell you what to run.`;
