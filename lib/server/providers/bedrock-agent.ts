import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import type { AstraEvent, AstraMessage, AstraPart } from "@/lib/types";
import { serverConfig } from "../config";
import { textOf, type ChatProvider, type TurnRequest, type TurnResult } from "./types";

let client: BedrockAgentRuntimeClient | undefined;
function getClient(): BedrockAgentRuntimeClient {
  return (client ??= new BedrockAgentRuntimeClient({ region: serverConfig().region }));
}

/**
 * Agents for Amazon Bedrock. The agent keeps its own memory per `sessionId`,
 * so only the latest user message is sent. Tools are the agent's action groups,
 * configured in the Bedrock console, not Claude Astra's workspace tools.
 */
export function bedrockAgentProvider(sessionId: string): ChatProvider {
  return {
    async *streamTurn(req: TurnRequest): AsyncGenerator<AstraEvent, TurnResult, undefined> {
      const cfg = serverConfig();
      if (!cfg.bedrockAgentId || !cfg.bedrockAgentAliasId) throw new Error("BEDROCK_AGENT_ID / BEDROCK_AGENT_ALIAS_ID are not set");
      const lastUser: AstraMessage | undefined = [...req.messages].reverse().find((m) => m.role === "user");
      const inputText = lastUser ? textOf(lastUser.parts) : "";
      const res = await getClient().send(
        new InvokeAgentCommand({
          agentId: cfg.bedrockAgentId,
          agentAliasId: cfg.bedrockAgentAliasId,
          sessionId,
          inputText,
          enableTrace: true,
        }),
        { abortSignal: req.signal },
      );
      let text = "";
      const decoder = new TextDecoder();
      for await (const ev of res.completion ?? []) {
        if (ev.chunk?.bytes) {
          const delta = decoder.decode(ev.chunk.bytes, { stream: true });
          text += delta;
          yield { type: "text", delta };
        } else if (ev.trace?.trace) {
          const t = ev.trace.trace;
          const rationale = t.orchestrationTrace?.rationale?.text;
          const action = t.orchestrationTrace?.invocationInput?.actionGroupInvocationInput;
          if (rationale) yield { type: "thinking", delta: rationale + "\n" };
          if (action?.actionGroupName) yield { type: "status", text: `agent → ${action.actionGroupName}${action.function ? `.${action.function}` : ""}` };
        }
      }
      const parts: AstraPart[] = text ? [{ type: "text", text }] : [];
      return { parts, raw: parts, stopReason: "end_turn" };
    },
  };
}
