"use client";
import type { SetupKey, SetupStep } from "./status";
import { Button, Panel, StatusPill } from "./ui";

export function SetupChecklist({ steps, onGo }: { steps: SetupStep[]; onGo: (key: SetupKey) => void }) {
  if (steps.every((step) => step.done)) return null;
  const done = steps.filter((step) => step.done).length;
  return (
    <Panel>
      <h2 className="text-base font-semibold">Finish setup</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{done} of {steps.length} complete. Monitoring works best with every step done.</p>
      <ul className="mt-3 divide-y divide-[var(--line)]">
        {steps.map((step) => (
          <li key={step.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill tone={step.done ? "ok" : "neutral"} label={step.done ? "Done" : "To do"} />
              {step.label}
            </span>
            {!step.done && <Button onClick={() => onGo(step.key)}>Go to setup<span className="sr-only">: {step.label}</span></Button>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
