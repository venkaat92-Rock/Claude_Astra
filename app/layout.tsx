import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Astra",
  description: "Claude Code-style agent workbench on AWS Amplify + Amazon Bedrock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
