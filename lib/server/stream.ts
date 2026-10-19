import type { AstraEvent } from "@/lib/types";

/** Encode an async generator of events as an NDJSON HTTP response body. */
export function ndjsonResponse(
  gen: AsyncGenerator<AstraEvent, void, unknown>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ndjson] stream failed", err);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message } satisfies AstraEvent) + "\n"));
        controller.close();
      }
    },
    cancel() {
      void gen.return();
    },
  });
  signal?.addEventListener("abort", () => void gen.return());
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export function jsonError(message: string, status = 400, code?: string): Response {
  return Response.json({ error: message, code }, { status });
}
