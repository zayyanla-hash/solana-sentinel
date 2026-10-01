/**
 * Wallet-scoped rule creation is two requests: the existing alert_create (which cannot carry a wallet, token or
 * cooldown) followed by a patch. If the patch fails the rule must not survive: an unfiltered rule would fire for
 * every wallet, which is not what the person asked for.
 */
import { HttpError } from "./api";
import { describeError } from "./status";

export type ScopedRuleInput = { side: "BUY" | "SELL"; name: string; wallet: string; mint: string; cooldownMinutes: number };

export type ScopedRuleDeps = {
  create: (name: string, trigger: string) => Promise<{ rule?: { id?: string } } | undefined>;
  patch: (id: string, patch: { name: string; wallet: string; mint: string | null; cooldownMinutes: number }) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

export class ScopedRuleError extends Error {
  constructor(message: string, readonly cause: unknown, readonly cleanedUp: boolean) {
    super(message);
  }
}

export async function createScopedRule(input: ScopedRuleInput, deps: ScopedRuleDeps): Promise<string> {
  const created = await deps.create(input.name, `TRACKED_WALLET_${input.side}`);
  const id = created?.rule?.id;
  if (!id) throw new ScopedRuleError("The rule was created without an id, so it could not be scoped to this wallet.", null, false);
  try {
    await deps.patch(id, { name: input.name, wallet: input.wallet, mint: input.mint || null, cooldownMinutes: input.cooldownMinutes });
  } catch (error) {
    let cleanedUp = false;
    try {
      await deps.remove(id);
      cleanedUp = true;
    } catch {
      cleanedUp = false;
    }
    // An ended session must still end the session in the caller, so surface the original error untouched.
    if (error instanceof HttpError && error.status === 401) throw error;
    const reason = error instanceof HttpError ? describeError(error.code, error.message) : error instanceof Error ? error.message : "Request failed";
    throw new ScopedRuleError(
      cleanedUp
        ? `The wallet filter could not be saved (${reason}). The alert was not created.`
        : `The wallet filter could not be saved (${reason}) and the unfiltered "${input.name}" rule could not be removed. Delete it in Alerts so it does not fire for every wallet.`,
      error,
      cleanedUp,
    );
  }
  return id;
}
