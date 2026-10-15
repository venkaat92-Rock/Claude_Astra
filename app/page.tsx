import { AuthGate } from "@/components/AuthGate";
import { Terminal } from "@/components/Terminal";

export default function Page() {
  return (
    <AuthGate>
      <Terminal />
    </AuthGate>
  );
}
