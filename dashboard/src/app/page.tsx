import { Dashboard } from "@/components/Dashboard";
import { config } from "@/lib/config";

export default function Page() {
  return <Dashboard deviceCode={config.deviceCode} />;
}
