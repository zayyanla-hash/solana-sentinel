import ResearchDashboard from "./ResearchDashboard";
import TeamDashboard from "./TeamDashboard";
export const dynamic = "force-dynamic";
export default function Page() {
  return process.env.SENTINEL_TEAM_MODE === "true" ? <TeamDashboard /> : <ResearchDashboard />;
}
