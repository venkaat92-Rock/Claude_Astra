// Amplify Hosting writes amplify_outputs.json during `ampx pipeline-deploy`.
// For local builds that have not run `ampx sandbox`, write a stub so the
// import in lib/amplify-config.ts resolves. The app detects the stub and
// runs in "no auth" mode only when ASTRA_AUTH_MODE=none is set explicitly.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "amplify_outputs.json");
if (!existsSync(target)) {
  writeFileSync(target, JSON.stringify({ version: "1", _stub: true }, null, 2) + "\n");
  console.log("[claude-astra] wrote stub amplify_outputs.json (run `npx ampx sandbox` to generate a real one)");
}
