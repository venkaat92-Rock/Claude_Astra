import {
  BedrockRuntimeClient,
  GetAsyncInvokeCommand,
  StartAsyncInvokeCommand,
  type StartAsyncInvokeCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { serverConfig } from "../config";
import { presignS3 } from "../workspace";

export interface VideoRequest {
  prompt: string;
  /** Bedrock model id: amazon.nova-reel-v1:1 (default) or luma.ray-v2:0 */
  modelId?: string;
  /** Nova Reel: 6 (single shot). Luma: 5 or 9. */
  durationSeconds?: number;
  seed?: number;
  /** Scope output keys per user. */
  userId: string;
}

export interface VideoJob {
  invocationArn: string;
  modelId: string;
  outputS3Uri: string;
}

export interface VideoStatus {
  invocationArn: string;
  status: "InProgress" | "Completed" | "Failed";
  failureMessage?: string;
  submitTime?: string;
  endTime?: string;
  outputS3Uri?: string;
  /** Presigned URL of output.mp4 once Completed. */
  videoUrl?: string;
}

function buildModelInput(modelId: string, req: VideoRequest): Record<string, unknown> {
  if (modelId.startsWith("luma.")) {
    const duration = req.durationSeconds === 9 ? "9s" : "5s";
    return {
      prompt: req.prompt.slice(0, 2048),
      aspect_ratio: "16:9",
      loop: false,
      duration,
      resolution: "720p",
    };
  }
  // Amazon Nova Reel (single-shot TEXT_VIDEO)
  return {
    taskType: "TEXT_VIDEO",
    textToVideoParams: { text: req.prompt.slice(0, 512) },
    videoGenerationConfig: {
      durationSeconds: 6,
      fps: 24,
      dimension: "1280x720",
      seed: req.seed ?? Math.floor(Math.random() * 2_147_483_646),
    },
  };
}

/** Start an asynchronous video generation job. Output is written to the media bucket. */
export async function startVideo(req: VideoRequest): Promise<VideoJob> {
  const cfg = serverConfig();
  if (!cfg.mediaBucket) throw new Error("ASTRA_MEDIA_BUCKET is not configured");
  const modelId = req.modelId ?? "amazon.nova-reel-v1:1";
  const client = new BedrockRuntimeClient({ region: cfg.region });
  const safeUser = req.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const s3Uri = `s3://${cfg.mediaBucket}/${cfg.mediaPrefix}${safeUser}/`;
  const res = await client.send(
    new StartAsyncInvokeCommand({
      modelId,
      modelInput: buildModelInput(modelId, req) as StartAsyncInvokeCommandInput["modelInput"],
      outputDataConfig: { s3OutputDataConfig: { s3Uri } },
    }),
  );
  if (!res.invocationArn) throw new Error("StartAsyncInvoke returned no invocationArn");
  return { invocationArn: res.invocationArn, modelId, outputS3Uri: s3Uri };
}

/** Poll a video job; when complete, presign `output.mp4`. */
export async function getVideoStatus(invocationArn: string): Promise<VideoStatus> {
  const cfg = serverConfig();
  const client = new BedrockRuntimeClient({ region: cfg.region });
  const res = await client.send(new GetAsyncInvokeCommand({ invocationArn }));
  const status = (res.status ?? "InProgress") as VideoStatus["status"];
  const outputS3Uri = res.outputDataConfig?.s3OutputDataConfig?.s3Uri;
  const out: VideoStatus = {
    invocationArn,
    status,
    failureMessage: res.failureMessage,
    submitTime: res.submitTime?.toISOString(),
    endTime: res.endTime?.toISOString(),
    outputS3Uri,
  };
  if (status === "Completed" && outputS3Uri) {
    // Bedrock writes to <s3Uri>/<invocationId>/output.mp4
    const invocationId = invocationArn.split("/").pop()!;
    const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(outputS3Uri);
    if (m) {
      const [, bucket, prefix] = m;
      const key = `${prefix.replace(/\/?$/, "/")}${invocationId}/output.mp4`;
      out.videoUrl = await presignS3(bucket, key);
    }
  }
  return out;
}
