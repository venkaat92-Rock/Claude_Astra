import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito user pool for Claude Astra.
 * Email + password sign-in. Add social providers later via `externalProviders`.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  userAttributes: {
    preferredUsername: { mutable: true, required: false },
  },
});
