"use client";

import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { Authenticator, ThemeProvider, createTheme, defaultDarkModeOverride } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { amplifyOutputs, hasAmplifyAuth } from "@/lib/amplify-config";
import { readTheme, type Theme } from "@/lib/client/useTheme";

if (hasAmplifyAuth) {
  Amplify.configure(amplifyOutputs as Parameters<typeof Amplify.configure>[0], { ssr: true });
}

const theme = createTheme({
  name: "astra",
  overrides: [defaultDarkModeOverride],
  tokens: {
    colors: { brand: { primary: { 80: "#d97757", 90: "#c4663f", 100: "#b25a36" } } },
    fonts: { default: { variable: "var(--mono)", static: "var(--mono)" } },
  },
});

/**
 * Wraps the app in Cognito sign-in when amplify_outputs.json has an auth block.
 * Without it (local dev, ASTRA_AUTH_MODE=none on the server) the app renders directly.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Theme>("light");
  useEffect(() => { setMounted(true); setMode(readTheme()); }, []);
  if (!mounted) return null;
  if (!hasAmplifyAuth) return <>{children}</>;
  // Accounts are created by an administrator in the Cognito console; there is no self sign-up.
  return (
    <ThemeProvider theme={theme} colorMode={mode}>
      <div className="auth-shell">
        <Authenticator hideSignUp variation="default">
          {() => <>{children}</>}
        </Authenticator>
      </div>
    </ThemeProvider>
  );
}
