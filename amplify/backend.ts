import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { PolicyStatement, Effect, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { storage } from "./storage/resource";

/**
 * Claude Astra backend.
 *
 * - auth:    Cognito user pool (admin-created accounts only; self sign-up is off)
 * - storage: S3 bucket for agent workspaces and saved conversations
 * - mediaBucket: S3 bucket Bedrock writes generated videos into
 * - computeRole: IAM role you attach to the Amplify Hosting SSR compute so
 *   route handlers can call Bedrock, read/write both buckets, and invoke Bedrock Agents.
 *
 * After the first deploy, copy the `computeRoleArn` and `mediaBucketName` outputs
 * into the Amplify Console (see docs/AWS_SETUP.md, steps 6-7).
 */
const backend = defineBackend({ auth, storage });

// Only an administrator creates accounts (Cognito console -> Users -> Create user).
// Self sign-up is disabled at the user pool level, and the sign-in UI hides the Sign up tab.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

const mediaStack = backend.createStack("ClaudeAstraMedia");

const mediaBucket = new Bucket(mediaStack, "MediaBucket", {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  // Generated videos are kept indefinitely; add a lifecycleRules expiration here if you want them auto-deleted.
});

const workspaceBucket = backend.storage.resources.bucket;
const region = Stack.of(mediaStack).region;
const account = Stack.of(mediaStack).account;

/** Bedrock permissions the app needs. Narrow `resources` once you know which models you use. */
const bedrockInvoke = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    // Claude via the Messages-API endpoint (bedrock-mantle) and legacy InvokeModel/Converse.
    "bedrock-mantle:CreateInference",
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream",
    "bedrock:Converse",
    "bedrock:ConverseStream",
    // Async video generation (Nova Reel, Luma Ray 2).
    "bedrock:StartAsyncInvoke",
    "bedrock:GetAsyncInvoke",
    "bedrock:ListAsyncInvokes",
    // Catalog + access checks used by scripts/check-bedrock-access.ts.
    "bedrock:ListFoundationModels",
    "bedrock:GetFoundationModel",
    "bedrock:ListInferenceProfiles",
    // Agents for Amazon Bedrock.
    "bedrock:InvokeAgent",
  ],
  resources: ["*"],
});

const bucketAccess = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
  resources: [
    mediaBucket.bucketArn,
    `${mediaBucket.bucketArn}/*`,
    workspaceBucket.bucketArn,
    `${workspaceBucket.bucketArn}/*`,
  ],
});

/**
 * Role for the Amplify Hosting SSR compute. Amplify assumes it with the
 * amplify.amazonaws.com service principal. Attach it in the Console under
 * App settings -> IAM roles -> Compute role.
 */
const computeRole = new Role(mediaStack, "AstraComputeRole", {
  assumedBy: new ServicePrincipal("amplify.amazonaws.com"),
  description: "Claude Astra SSR compute role: Bedrock + S3 access for route handlers",
});
computeRole.addToPolicy(bedrockInvoke);
computeRole.addToPolicy(bucketAccess);

/**
 * Bedrock writes async-invoke output to S3 using the caller's identity, so the
 * media bucket needs no extra bucket policy. If you later move video jobs to a
 * dedicated Bedrock service role, grant that role `s3:PutObject` here.
 */

backend.addOutput({
  custom: {
    region,
    account,
    mediaBucketName: mediaBucket.bucketName,
    workspaceBucketName: workspaceBucket.bucketName,
    computeRoleArn: computeRole.roleArn,
  },
});
