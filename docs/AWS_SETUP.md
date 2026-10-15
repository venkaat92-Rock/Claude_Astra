# Claude Astra — AWS setup, step by step

This guide takes you from an empty AWS account to Claude Astra running on
Amplify Hosting with Claude, Amazon Nova, Luma video and (optionally) Google
Gemini behind it. Budget 45–60 minutes the first time.

Everything below uses **us-east-1** because it is the one region that has every
model Claude Astra uses out of the box. If you deploy elsewhere, re-check model
availability in the Bedrock console for that region first.

---

## 0. What you will end up with

| Piece | AWS service | Created by |
|---|---|---|
| Web app + API routes (Next.js) | Amplify Hosting (SSR compute) | Amplify, from this repo |
| Sign-in | Cognito user pool | `amplify/auth/resource.ts` |
| Agent workspaces (files the agent edits) | S3 bucket | `amplify/storage/resource.ts` |
| Generated videos | S3 bucket | `amplify/backend.ts` (`MediaBucket`) |
| Conversation table (provisioned, not yet wired to the UI) | DynamoDB via AppSync | `amplify/data/resource.ts` |
| Server permissions for Bedrock + S3 | IAM role `AstraComputeRole` | `amplify/backend.ts` |
| Claude, Nova, Luma inference | Amazon Bedrock | you enable model access |
| Gemini (optional) | Google AI Studio, **not** AWS | API key in env vars |
| A Bedrock Agent (optional) | Agents for Amazon Bedrock | you create it in the console |

How the model families reach the app:

- **Claude** — Bedrock's Messages-API endpoint (`bedrock-mantle`), via `@anthropic-ai/bedrock-sdk`'s `AnthropicBedrockMantle` client. Same request shape as Anthropic's API, SigV4 auth from the compute role.
- **Amazon Nova (text)** — Bedrock Converse API via `@aws-sdk/client-bedrock-runtime`.
- **Nova Canvas (image)** — Bedrock `InvokeModel`.
- **Nova Reel / Luma Ray 2 (video)** — Bedrock `StartAsyncInvoke`; output lands in the media bucket.
- **Gemini** — Google's Gen AI SDK with an AI Studio key. Gemini is not on Bedrock; only Google's open-weight Gemma models are.
- **Bedrock Agents** — `InvokeAgent` with streaming.

---

## 1. Prerequisites on your laptop

```bash
node -v        # 20 or newer
npm -v
aws --version  # AWS CLI v2
aws configure  # access key, secret, region us-east-1, output json
```

Use an IAM user or Identity Center profile with admin rights for the setup
steps; the app itself runs with the narrower `AstraComputeRole`.

---

## 2. Enable Bedrock model access

1. Console → **Amazon Bedrock** → left nav **Model access** (region **us-east-1**).
2. Click **Modify model access** (or **Enable specific models**) and tick:
   - Anthropic: **Claude Opus 5.5**, **Claude Sonnet 5.5**, **Claude Haiku 5.5**, **Claude Fable 5.1**, **Claude Opus 4.8**
   - Amazon: **Nova 2 Lite**, **Nova Pro**, **Nova Premier**, **Nova Canvas**, **Nova Reel**
   - Luma AI: **Ray 2** (enable in **us-west-2** too; Luma may not be offered in us-east-1)
3. Anthropic models may show a short use-case form the first time. Fill it in; approval is usually immediate.
4. Confirm each row reads **Access granted**.

Then verify from your laptop:

```bash
npm install
AWS_REGION=us-east-1 npx tsx scripts/check-bedrock-access.ts
```

You want `PASS` on credentials, Claude and Nova. The media-bucket line will fail until step 5.

> Model ids in `lib/models.ts` are current as of October 2026. If a call fails
> with "model not found" or "use an inference profile", open Bedrock → **Model
> catalog**, copy the exact id (or the `us.` / `global.` inference-profile id)
> and override it with an `ASTRA_MODELS_JSON` file (see §9).

---

## 3. The code is in GitHub

Claude Astra lives in its own repository: https://github.com/venkaat92-Rock/Claude_Astra
(`main` branch, app at the repository root). Amplify connects to it directly in
the next step; no "app root" or monorepo setting is needed.

---

## 4. Create the Amplify app and connect the repo

1. Console → **AWS Amplify** → **Create new app** → **GitHub** → authorise the Amplify GitHub app for the repository.
2. Pick the repo and branch (`main`). Amplify detects Next.js and Amplify Gen 2 and shows `amplify.yml` from the repo. Keep it.
3. Under **Service role**, let Amplify create one (it needs it to run `ampx pipeline-deploy`, which creates Cognito, S3, DynamoDB and the compute role via CloudFormation).
4. **Save and deploy**. The first build takes ~10 minutes. It will succeed, but the app will not work yet because the compute role and env vars are not set (steps 6–7).

---

## 5. Note the backend outputs

When the build finishes, open the **Deployed backend resources** tab (or
CloudFormation → stack `amplify-claudeastra-main-…` → **Outputs**) and copy:

- `mediaBucketName` — the S3 bucket for video output
- `workspaceBucketName` — the S3 bucket for agent workspaces
- `computeRoleArn` — the IAM role for the SSR compute

(They are also in `amplify_outputs.json` under `custom` after `npx ampx sandbox`.)

---

## 6. Attach the compute role

Route handlers run on Amplify's SSR compute. By default that compute has **no**
AWS permissions, so Bedrock calls would fail with `CredentialsProviderError`.

1. Amplify → your app → **App settings** → **IAM roles**.
2. **Compute role** → **Edit** → pick `AstraComputeRole` (the role whose ARN you copied; its name starts with `amplify-…-AstraComputeRole…`).
3. Save. Redeploy the branch (Deployments → **Redeploy this version**).

What the role allows (see `amplify/backend.ts`): `bedrock-mantle:CreateInference`,
`bedrock:InvokeModel*`, `bedrock:Converse*`, `bedrock:StartAsyncInvoke`,
`bedrock:GetAsyncInvoke`, `bedrock:InvokeAgent`, plus read/write on the two
buckets. Narrow the Bedrock `resources` to specific model ARNs once you know
which models you keep.

---

## 7. Environment variables

Amplify → **App settings** → **Environment variables** → add:

| Key | Value | Required |
|---|---|---|
| `AWS_REGION` | `us-east-1` | yes |
| `ASTRA_MEDIA_BUCKET` | `mediaBucketName` from step 5 | for video |
| `ASTRA_MEDIA_PREFIX` | `videos/` | no |
| `ASTRA_DEFAULT_MODEL` | `claude-opus-5-5` | no |
| `ASTRA_CLAUDE_FALLBACK_MODEL` | `anthropic.claude-opus-4-8` | no (client-side fallback when Claude returns `stop_reason: refusal`) |
| `GOOGLE_API_KEY` | key from https://aistudio.google.com/apikey | for Gemini |
| `BEDROCK_AGENT_ID` | from step 10 | for Bedrock Agents |
| `BEDROCK_AGENT_ALIAS_ID` | from step 10 | for Bedrock Agents |

Do **not** set `ASTRA_AUTH_MODE` on Amplify. Redeploy after saving.

The workspace bucket is read from `amplify_outputs.json` automatically; set
`ASTRA_WORKSPACE_BUCKET` only if you want a different bucket.

---

## 8. First sign-in and smoke test

1. Open the Amplify URL. You get the Cognito sign-up form. Create an account and confirm the email code.
2. In the terminal: `/models` lists the catalog with availability. `/model claude-sonnet-5-5` switches models.
3. Try: `create hello.md in my workspace with a short greeting, then read it back`. You should see `write_file` and `read_file` tool blocks and the file in the right panel.
4. `/image a watercolor lighthouse at dusk` → Nova Canvas → image preview.
5. `/video a drone shot over a misty forest at sunrise` → returns an invocation ARN. After 2–8 minutes `/video status <arn>` returns a playable URL. The agent can do the same with its `generate_video` / `check_video` tools.

If a Claude call fails with `AccessDeniedException`, re-check step 2 in the
**same region** as `AWS_REGION`. If it fails with `CredentialsProviderError`,
step 6 was skipped.

---

## 9. Changing or adding models

`lib/models.ts` is the default catalog. To change ids without touching code,
add a JSON file and point `ASTRA_MODELS_JSON` at it (relative to the app root):

```json
[
  { "id": "claude-opus-5-5", "apiModelId": "anthropic.claude-opus-5-5" },
  { "id": "nova-2-pro", "label": "Amazon Nova 2 Pro", "vendor": "Amazon", "provider": "bedrock-converse",
    "apiModelId": "us.amazon.nova-2-pro-v1:0", "capabilities": ["chat", "tools", "vision"],
    "description": "Nova 2 Pro", "enabled": true },
  { "id": "gemma-4-31b", "enabled": true }
]
```

Entries merge by `id`; new ids are appended. Provider choices:

| `provider` | Use for |
|---|---|
| `anthropic-bedrock` | any Claude model (id `anthropic.claude-…`) |
| `bedrock-converse` | Nova, Llama, Mistral, DeepSeek, Gemma… anything on the Converse API |
| `gemini` | Google Gemini model names (`gemini-2.5-pro`, …) |
| `bedrock-image` | Nova Canvas-style `InvokeModel` image models |
| `bedrock-video` | Nova Reel / Luma `StartAsyncInvoke` video models |
| `bedrock-agent` | the agent in `BEDROCK_AGENT_ID` |

---

## 10. (Optional) Add a Bedrock Agent

If you want "Amazon agents" with their own action groups and knowledge bases:

1. Console → Bedrock → **Agents** → **Create agent**. Pick a Claude or Nova model, write instructions, add action groups (Lambda) or a knowledge base as you like.
2. **Prepare** the agent, then **Create alias** (e.g. `prod`).
3. Copy the **Agent ID** and **Alias ID** into the env vars from step 7 and redeploy.
4. In the app, `/agent` switches the conversation to that agent. Each Claude Astra conversation maps to one agent `sessionId`, so the agent keeps its own memory per conversation.

---

## 11. (Optional) Google Gemini

Gemini is not available on Bedrock. Claude Astra talks to Google directly:

1. https://aistudio.google.com/apikey → **Create API key**.
2. Set `GOOGLE_API_KEY` (step 7). The Gemini rows in `/models` flip to available.
3. For Vertex AI instead of AI Studio, swap the client construction in `lib/server/providers/gemini.ts` to `new GoogleGenAI({ vertexai: true, project, location })` and give the compute role Google credentials via Workload Identity Federation.

If you only want Google models that **are** on Bedrock, enable **Gemma 4** under Model access, confirm its id in the Model catalog, and enable the `gemma-4-31b` entry via `ASTRA_MODELS_JSON`.

---

## 12. Local development

```bash
cp .env.example .env.local      # edit AWS_REGION, ASTRA_MEDIA_BUCKET, GOOGLE_API_KEY
npx ampx sandbox                 # deploys a personal backend; writes amplify_outputs.json
npm run dev                      # http://localhost:3000 with real Cognito sign-in
```

Without a sandbox, set `ASTRA_AUTH_MODE=none` and `ASTRA_WORKSPACE_BUCKET=<any bucket you own>` in `.env.local`
to run as a single anonymous user with your local AWS credentials.

---

## 13. Costs and guardrails

- Bedrock bills per token / per image / per second of video. Claude Opus 5.5 is the default; switch the default to Sonnet or Haiku with `ASTRA_DEFAULT_MODEL` if cost matters more than capability.
- Video jobs are the expensive item (Nova Reel and Luma bill per generated second). The UI only starts a job on an explicit `/video` or when the agent calls `generate_video`.
- Add a Bedrock **Guardrail** and attach it in the console if you expose the app to other users; the Converse and Messages calls accept a guardrail id (not wired yet).
- Cognito sign-up is open by default. To restrict, set `signUpVerificationMethod` / disable self-registration in the user pool, or add allowed email domains with a pre-sign-up Lambda trigger.
