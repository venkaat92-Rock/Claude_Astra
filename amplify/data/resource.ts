import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Conversation persistence. Each signed-in user owns their conversations.
 * Message content is stored as a JSON string so provider-native blocks
 * (e.g. Claude thinking blocks that must be replayed verbatim) survive intact.
 */
const schema = a.schema({
  Conversation: a
    .model({
      title: a.string(),
      modelId: a.string().required(),
      messagesJson: a.string().required(),
      lastActiveAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
