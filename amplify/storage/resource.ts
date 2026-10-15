import { defineStorage } from "@aws-amplify/backend";

/**
 * S3 bucket for per-user agent workspaces.
 * Only the server (SSR compute role) and the owning user can touch
 * `workspaces/{identityId}/*`. The agent's file tools operate inside that prefix.
 */
export const storage = defineStorage({
  name: "claudeAstraWorkspaces",
  access: (allow) => ({
    "workspaces/{entity_id}/*": [
      allow.entity("identity").to(["read", "write", "delete"]),
    ],
  }),
});
