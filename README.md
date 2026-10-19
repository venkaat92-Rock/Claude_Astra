# ✦ Claude Astra

A Claude Code-style agent workbench you host yourself: a terminal-like web UI on
**AWS Amplify**, with **Amazon Bedrock** behind it for **Claude**, **OpenAI GPT-6**
(Astra, 6.1 Sol, Sol, Luna), **Amazon Nova** (text, image, video), **Luma Ray 2**
video and **Bedrock Agents**, plus optional **Google Gemini** through Google's API.

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
| Amplify Gen 2 backend: Cognito (admin-created accounts), S3 workspaces + saved chats, media bucket, compute IAM role | `amplify/` |
| Step-by-step AWS guide | [`docs/AWS_SETUP.md`](docs/AWS_SETUP.md) |

## Quick start (local)

```bash
git clone https://github.com/venkaat92-Rock/Claude_Astra.git && cd Claude_Astra
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
4. Set `ASTRA_MEDIA_BUCKET` (+ `GOOGLE_API_KEY`, `BEDROCK_AGENT_ID` if used) as environment variables. Don't set `AWS_REGION`; Amplify reserves the `AWS` prefix.
5. Redeploy, sign up, type `/help`.

## Model status

The model picker shows two groups. **Tested & working** lists models confirmed end to end in the deployed app; **Yet to work** lists the rest of the catalog. Status lives in `lib/models.ts` (`status: "working" | "untested" | "retired"`); move a model up once you've seen it answer.

| Status | Models |
|---|---|
| Tested & working (priority order) | Claude Opus 5.5, OpenAI GPT-6 Astra, Claude Opus 4.5, Claude Haiku 4.5, Amazon Nova 2 Lite, Claude Sonnet 4.5, Mistral Pixtral Large, Meta Llama 4 Maverick, Meta Llama 4 Scout, Amazon Nova Pro. Claude Opus 5.5, GPT-6 Astra and the Nova models were confirmed in this app; the rest were verified through the same Converse API in the same AWS account by the DiagramIQ project |
| Yet to work | Claude Fable 5.1 / Sonnet 5.5 / Haiku 5.5 / Opus 4.8 (routed via Converse like Opus 5.5), GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna, Gemini (needs `GOOGLE_API_KEY`), Bedrock Agent (needs ids), Nova Canvas, Nova Reel, Luma Ray 2 (need `ASTRA_BEDROCK_REGION` / `ASTRA_MEDIA_BUCKET`) |
| Retired | Amazon Nova Premier |

## Slash commands

```
/help  /model [id]  /models  /effort <low|medium|high|xhigh|max>
/image <prompt>  /video <prompt> | /video luma <prompt> | /video status <arn>
/files  /cat <path>  /agent  /theme  /clear
```

## Design notes

- **Claude on Bedrock** uses the Messages-API endpoint (`AnthropicBedrockMantle`), so adaptive thinking, `effort`, tool use and prompt caching work as on Anthropic's API. The system prompt and tool list are frozen per conversation and assistant turns are replayed verbatim (`raw`), which keeps Claude's thinking blocks valid across turns.
- **Refusals** (`stop_reason: refusal`) are surfaced in the UI; set `ASTRA_CLAUDE_FALLBACK_MODEL` to re-run them on another Claude model client-side (Bedrock has no server-side fallback).
- **Nova / other Bedrock models** go through the Converse API with the same tool definitions, so the agent loop is provider-neutral.
- **Gemini is not on Bedrock.** The `gemini` provider calls Google directly; the only Google models Bedrock offers are open-weight Gemma, which you can enable as a `bedrock-converse` entry.
- **Video is asynchronous.** `generate_video` returns an invocation ARN; `check_video` (or `/video status`) polls and presigns `output.mp4` from the media bucket.
- **Chats are saved in the cloud.** Each conversation is stored in the user's S3 workspace under `.astra/conversations/`, so the chat list on the left follows the user to any device. Double-click a chat to rename it.
- **Attachments.** Paperclip, drag-and-drop or paste. Files go straight from the browser to `uploads/` in the S3 workspace with a presigned URL, and images and PDFs are referenced by path, so chat requests stay small no matter how many files a conversation has. The server loads the bytes just before calling the model. Small text files are inlined. Word, PowerPoint, Excel and PDF uploads are converted to text on the server (saved as `<name>.txt`, inlined when small), and the agent's `read_file` converts them too.
- **Files back to you.** `create_pptx` (PowerPoint decks: title, bullet, two-column, table and image slides with speaker notes), `create_docx` (Word from Markdown) and `create_xlsx` (Excel with numbers and formulas) save to the workspace, and every created or written file shows a download button in the chat. The Workspace panel has a ⬇ button per file.
- **Voice input.** The 🎤 button dictates into the prompt box with the browser's speech recognition (Chrome, Edge and Safari, including iPhone; not Firefox). Speak, tap ■, review, press Enter.
- **Long runs and HTTP errors.** Amplify cuts requests at about 30 seconds and rejects request bodies of a few MB. A chat request pauses between tool rounds after `ASTRA_REQUEST_BUDGET_SECONDS` (default 20) and the browser resumes it automatically, older tool output is shortened in requests when a conversation grows large, and every server error comes back as a readable message instead of a bare "HTTP 500".
- **Accounts are admin-created.** Self sign-up is disabled in the user pool and hidden from the sign-in screen; create users in the Cognito console.
- **Light theme by default**, dark via the ☾ button or `/theme`.
- No shell execution: the agent writes files and tells you what to run. Add AgentCore Code Interpreter or a Lambda-backed `run_command` tool if you need execution.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `npm run build` | Next.js |
| `npm run typecheck` / `npm run lint` | TypeScript + ESLint |
| `npm run sandbox` | `ampx sandbox` (personal Amplify backend) |
| `npm run check:bedrock` | Verify Bedrock access from your credentials |
