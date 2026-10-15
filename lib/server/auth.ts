import { cookies } from "next/headers";
import { createServerRunner } from "@aws-amplify/adapter-nextjs";
import { fetchAuthSession } from "aws-amplify/auth/server";
import { amplifyOutputs, hasAmplifyAuth } from "@/lib/amplify-config";
import { serverConfig } from "./config";

export interface AstraUser {
  /** Cognito `sub`, or "local-dev" when ASTRA_AUTH_MODE=none. */
  userId: string;
  /** Cognito identity-pool id used as the workspace prefix. */
  identityId: string;
  email?: string;
}

const runner = hasAmplifyAuth
  ? createServerRunner({ config: amplifyOutputs as Parameters<typeof createServerRunner>[0]["config"] })
  : undefined;

export class UnauthorizedError extends Error {
  status = 401;
}

/** Resolve the signed-in user from the request cookies (Amplify SSR). */
export async function requireUser(): Promise<AstraUser> {
  const cfg = serverConfig();
  if (cfg.authMode === "none") {
    return { userId: "local-dev", identityId: "local-dev" };
  }
  if (!runner) {
    throw new UnauthorizedError("Amplify auth is not configured (amplify_outputs.json missing). Run `npx ampx sandbox` or set ASTRA_AUTH_MODE=none for local dev.");
  }
  const session = await runner.runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (ctx) => fetchAuthSession(ctx),
  });
  const sub = session.tokens?.idToken?.payload?.sub;
  if (!sub || typeof sub !== "string") throw new UnauthorizedError("Sign in required");
  const email = session.tokens?.idToken?.payload?.email;
  return {
    userId: sub,
    identityId: session.identityId ?? sub,
    email: typeof email === "string" ? email : undefined,
  };
}
