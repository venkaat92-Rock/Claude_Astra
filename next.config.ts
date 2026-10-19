import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Streaming route handlers (chat, agents) run on the Amplify SSR compute.
  // Keep the AWS SDK and the Anthropic SDK out of the client bundle.
  serverExternalPackages: [
    "@anthropic-ai/bedrock-sdk",
    "@anthropic-ai/sdk",
    "@aws-sdk/client-bedrock-runtime",
    "@aws-sdk/client-bedrock-agent-runtime",
    "@aws-sdk/client-s3",
    "@google/genai",
    "pptxgenjs",
    "docx",
  ],
  experimental: {
    // Allow large base64 image payloads from Nova Canvas to flow through route handlers.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
