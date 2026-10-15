# ✦ Claude Astra

A Claude Code-style agent workbench you host yourself: a terminal-like web UI on
**AWS Amplify**, with **Amazon Bedrock** behind it for **Claude**, **Amazon Nova**
(text, image, video), **Luma Ray 2** video and **Bedrock Agents**, plus optional
**Google Gemini** through Google's API.

```
❯ create a FastAPI hello-world in api/main.py and a Dockerfile for it
● Claude Opus 5.5
  ✎ write_file  api/main.py                         done
  ✎ write_file  Dockerfile                          done
  Wrote both files. Run locally with:
  docker build -t hello . && docker run -p 8000:8000 hello
```

## What is in the box

| Area | Where |
|---|---|
| Terminal UI (streaming, tool blocks, thinking, slash commands, model picker, workspace panel) | `components/`, `lib/client/` |
| Agent loop (parallel tool calls, append-only history, max 30 iterations) | `lib/server/agent/loop.ts` |
| Tools: workspace files on S3, search, web fetch, Nova Canvas image, Nova Reel / Luma video | `lib/server/agent/tools.ts` |
| Providers: Claude on Bedrock, Nova via Converse, Gemini, Bedrock Agents, image, video | `lib/server/providers/` |
| Model catalog (override with `ASTRA_MODELS_JSON`) | `lib/models.ts` |
| HTTP API: `/api/chat` (NDJSON stream), `/api/models`, `/api/workspace`, `/api/generate/image`, `/api/generate/video` | `app/api/` |
| Amplify Gen 2 backend: Cognito, S3 workspaces, media bucket, DynamoDB, compute IAM role | `amplify/` |
| Step-by-step AWS guide | [`docs/AWS_SETUP.md`](docs/AWS_SETUP.md) |

## Quick start (local)

```bash
cd claude-astra
npm install
cp .env.example .env.local        # set AWS_REGION, ASTRA_MEDIA_BUCKET; optionally GOOGLE_API_KEY
npx tsx scripts/check-bedrock-access.ts   # verifies model access + credentials
npx ampx sandbox                  # personal backend -> amplify_outputs.json
npm run dev                       # http://localhost:3000
```

Or skip Cognito for a quick look: set `ASTRA_AUTH_MODE=none` and
`ASTRA_WORKSPACE_BUCKET=<a bucket you own>` in `.env.local`, then `npm run dev`.

## Deploy to AWS

Follow [`docs/AWS_SETUP.md`](docs/AWS_SETUP.md). Short version:

1. Enable model access in Bedrock (Claude, Nova, Luma).
2. Connect the repo to Amplify Hosting; the build runs `ampx pipeline-deploy`.
3. Attach the generated `AstraComputeRole` as the Amplify **compute role**.
4. Set `AWS_REGION`, `ASTRA_MEDIA_BUCKET` (+ `GOOGLE_API_KEY`, `BEDROCK_AGENT_ID` if used) as environment variables.
5. Redeploy, sign up, type `/help`.

## Slash commands

```
/help  /model [id]  /models  /effort <low|medium|high|xhigh|max>
/image <prompt>  /video <prompt> | /video luma <prompt> | /video status <arn>
/files  /cat <path>  /agent  /clear
```

## Design notes

- **Claude on Bedrock** uses the Messages-API endpoint (`AnthropicBedrockMantle`), so adaptive thinking, `effort`, tool use and prompt caching work as on Anthropic's API. The system prompt and tool list are frozen per conversation and assistant turns are replayed verbatim (`raw`), which keeps Claude's thinking blocks valid across turns.
- **Refusals** (`stop_reason: refusal`) are surfaced in the UI; set `ASTRA_CLAUDE_FALLBACK_MODEL` to re-run them on another Claude model client-side (Bedrock has no server-side fallback).
- **Nova / other Bedrock models** go through the Converse API with the same tool definitions, so the agent loop is provider-neutral.
- **Gemini is not on Bedrock.** The `gemini` provider calls Google directly; the only Google models Bedrock offers are open-weight Gemma, which you can enable as a `bedrock-converse` entry.
- **Video is asynchronous.** `generate_video` returns an invocation ARN; `check_video` (or `/video status`) polls and presigns `output.mp4` from the media bucket.
- The UI persists the current conversation in `localStorage`. The `Conversation` data model in `amplify/data` is provisioned for server-side history but not wired to the UI yet.
- No shell execution: the agent writes files and tells you what to run. Add AgentCore Code Interpreter or a Lambda-backed `run_command` tool if you need execution.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build` | Next.js |
| `npm run typecheck` / `npm run lint` | TypeScript + ESLint |
| `npm run sandbox` | `ampx sandbox` (personal Amplify backend) |
| `npm run check:bedrock` | Verify Bedrock access from your credentials |
