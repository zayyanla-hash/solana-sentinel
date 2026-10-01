import {
  runFullResearchPass,
  runDemoExperiment,
  getSystemHealth,
  getOperatingMode,
  closeProviders,
} from "@sat/pipeline";
import { getDatabase, closeDatabase } from "@sat/database";

async function main() {
  const db = getDatabase();
  console.log(
    JSON.stringify(
      {
        service: "sat-worker",
        operatingMode: getOperatingMode(),
        note: "PAPER/DEMO worker — never broadcasts live swaps",
      },
      null,
      2,
    ),
  );

  const proposals = await runFullResearchPass(db);
  const experiment = await runDemoExperiment(db);
  const health = await getSystemHealth(db);

  console.log(
    JSON.stringify(
      {
        proposals: proposals.length,
        rejected: proposals.filter((p) => p.status === "REJECTED").length,
        proposed: proposals.filter((p) => p.status === "PROPOSED").length,
        experiment: experiment.experiment.name,
        health,
      },
      null,
      2,
    ),
  );
}

async function cleanup() {
  await closeProviders();
  await closeDatabase();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    void closeProviders().catch(() => { process.exitCode = 1; });
  });
}

main().finally(cleanup).catch((err) => {
  console.error(err);
  process.exitCode ??= 1;
});
