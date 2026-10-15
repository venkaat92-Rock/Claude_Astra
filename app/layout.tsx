import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Astra",
  description: "Claude Code-style agent workbench on AWS Amplify + Amazon Bedrock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a flash. Light is the default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("claude-astra:theme");if(t==="dark")document.documentElement.dataset.theme="dark";}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
