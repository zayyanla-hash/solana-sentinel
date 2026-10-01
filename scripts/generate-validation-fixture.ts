import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runValidation } from "../packages/validation-lab/src/index";

const dayMs = 86_400_000;
const startMs = Date.parse("2026-01-01T00:00:00.000Z");
const equity = Array.from({ length: 60 }, (_, i) => ({
  t: new Date(startMs + i * dayMs).toISOString(),
  nav: 1000,
}));
const benchmark = equity.map(({ t }) => ({ t, value: 1000 }));
const result = runValidation({
  equity,
  benchmark,
  dataSource: "SYNTHETIC_FLAT_NAV_FIXTURE",
  config: { bootstrapSamples: 0 },
});
const artifact = {
  dataStatus: "FIXTURE",
  note: "Synthetic flat NAV and benchmark. Demonstrates result shape only; no market or strategy performance claim.",
  result,
};
const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "artifacts", "validation");
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "synthetic-flat.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
