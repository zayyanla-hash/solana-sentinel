import type { AlertEvent } from "./types";

export type InboxSide = "buy" | "sell" | "neutral";

/** BUY/SELL only when the text says exactly one of them; otherwise neutral. Never guessed. */
export function inboxSide(event: Pick<AlertEvent, "title" | "body">): InboxSide {
  const text = `${event.title} ${event.body}`;
  const buy = /\bBUY\b/i.test(text);
  const sell = /\bSELL\b/i.test(text);
  if (buy && !sell) return "buy";
  if (sell && !buy) return "sell";
  return "neutral";
}

/** Newest first, live events only. */
export function inboxEvents(events: AlertEvent[]): AlertEvent[] {
  return events.filter((event) => !event.isDemo).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
