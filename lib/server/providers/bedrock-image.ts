import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { serverConfig } from "../config";

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  modelId?: string; // Bedrock model id, default Nova Canvas
}

/**
 * Amazon Nova Canvas text-to-image via InvokeModel (synchronous).
 * Returns PNG bytes.
 */
export async function generateImage(req: ImageRequest): Promise<{ png: Uint8Array; seed: number }> {
  const cfg = serverConfig();
  const client = new BedrockRuntimeClient({ region: cfg.region });
  const seed = req.seed ?? Math.floor(Math.random() * 858_993_459);
  const body = {
    taskType: "TEXT_IMAGE",
    textToImageParams: {
      text: req.prompt.slice(0, 1024),
      ...(req.negativePrompt ? { negativeText: req.negativePrompt.slice(0, 1024) } : {}),
    },
    imageGenerationConfig: {
      numberOfImages: 1,
      quality: "standard",
      width: req.width ?? 1024,
      height: req.height ?? 1024,
      cfgScale: 8.0,
      seed,
    },
  };
  const res = await client.send(
    new InvokeModelCommand({
      modelId: req.modelId ?? "amazon.nova-canvas-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    }),
  );
  const json = JSON.parse(new TextDecoder().decode(res.body)) as { images?: string[]; error?: string };
  if (json.error) throw new Error(`Nova Canvas: ${json.error}`);
  const b64 = json.images?.[0];
  if (!b64) throw new Error("Nova Canvas returned no image");
  return { png: Buffer.from(b64, "base64"), seed };
}
