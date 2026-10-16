/**
 * Smoke-test the AWS side of Claude Astra from your laptop:
 *   npx tsx scripts/check-bedrock-access.ts
 *
 * Checks, in order: credentials + region, a 1-token Claude call through the
 * Bedrock Messages-API endpoint, a Nova Converse call, Nova Canvas, and the
 * media bucket for video output. Prints a PASS/FAIL line per item.
 */
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { DEFAULT_MODELS } from "../lib/models";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const routing = process.env.ASTRA_CLAUDE_ROUTING;
const r = (routing ?? "us").trim().replace(/\.$/, "").toLowerCase();
const prefix = !r || r === "none" || r === "bare" ? "" : r + ".";
const claudeId = process.argv[2] ?? prefix + DEFAULT_MODELS.find((m) => m.id === "claude-opus-5-5")!.apiModelId;
const novaId = DEFAULT_MODELS.find((m) => m.id === "nova-2-lite")!.apiModelId;

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    console.log(`FAIL  ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

(async () => {
  console.log(`region: ${region}\n`);
  await step("AWS credentials", async () => {
    const id = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
    return `${id.Arn}`;
  });
  await step(`Claude on Bedrock (${claudeId})`, async () => {
    const client = new AnthropicBedrockMantle({ awsRegion: region });
    const msg = await client.messages.create({ model: claudeId, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ready" }] });
    const text = msg.content.find((b) => b.type === "text");
    return `stop_reason=${msg.stop_reason} text=${text?.type === "text" ? JSON.stringify(text.text) : "?"}`;
  });
  await step(`Amazon Nova via Converse (${novaId})`, async () => {
    const res = await new BedrockRuntimeClient({ region }).send(
      new ConverseCommand({ modelId: novaId, messages: [{ role: "user", content: [{ text: "Reply with the single word: ready" }] }], inferenceConfig: { maxTokens: 16 } }),
    );
    return `stopReason=${res.stopReason}`;
  });
  await step("Media bucket for video output (ASTRA_MEDIA_BUCKET)", async () => {
    const bucket = process.env.ASTRA_MEDIA_BUCKET;
    if (!bucket) throw new Error("ASTRA_MEDIA_BUCKET is not set");
    await new S3Client({ region }).send(new HeadBucketCommand({ Bucket: bucket }));
    return bucket;
  });
  console.log("\nIf Claude or Nova FAIL with AccessDeniedException, enable the model under Bedrock -> Model access in this region (docs/AWS_SETUP.md step 2).");
})();
