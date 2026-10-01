"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sortNewestFirst } from "./chart";
import type { ActivityResponse, Observation } from "./types";
import { messageOf } from "./useTeamWorkspace";

export type FeedEntry = { data: ActivityResponse | null; error: string | null; loading: boolean };

/** Minimum gap between two fetches of one wallet, so a burst of refreshes never turns into a burst of requests. */
const MIN_INTERVAL_MS = 10_000;

/**
 * Activity for every watched wallet, refreshed on the workspace's normal cycle (`tick` changes once per successful
 * refresh, which already pauses while the tab is hidden). Each wallet has its own request ticket: only the latest
 * request for a wallet may update it, and a wallet that disappears (or a session that ends) invalidates its tickets.
 */
export function useActivityFeed({ addresses, enabled, active, tick, load }: {
  addresses: string[];
  /** False while signed out or before the workspace is ready: everything is cleared and nothing is fetched. */
  enabled: boolean;
  /** True while a view that shows activity is visible. */
  active: boolean;
  tick: number | null;
  load: (wallet: string) => Promise<ActivityResponse>;
}) {
  const [entries, setEntries] = useState<Record<string, FeedEntry>>({});
  const tickets = useRef(new Map<string, number>());
  const lastFetch = useRef(new Map<string, number>());
  const counter = useRef(0);
  const key = addresses.join(",");

  const fetchOne = useCallback(async (address: string) => {
    const ticket = ++counter.current;
    tickets.current.set(address, ticket);
    lastFetch.current.set(address, Date.now());
    setEntries((current) => ({ ...current, [address]: { data: current[address]?.data ?? null, error: null, loading: true } }));
    try {
      const result = await load(address);
      if (tickets.current.get(address) !== ticket) return;
      setEntries((current) => ({ ...current, [address]: { data: result, error: null, loading: false } }));
    } catch (error) {
      if (tickets.current.get(address) !== ticket) return;
      setEntries((current) => ({ ...current, [address]: { data: current[address]?.data ?? null, error: messageOf(error), loading: false } }));
    }
  }, [load]);

  // Forget wallets that are no longer watched, or everything when the session is not ready.
  useEffect(() => {
    const keep = new Set(enabled ? key.split(",").filter(Boolean) : []);
    for (const address of [...tickets.current.keys()]) {
      if (!keep.has(address)) { tickets.current.delete(address); lastFetch.current.delete(address); }
    }
    setEntries((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([address]) => keep.has(address)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || !active) return;
    const now = Date.now();
    for (const address of key.split(",").filter(Boolean)) {
      const last = lastFetch.current.get(address);
      if (last === undefined || now - last >= MIN_INTERVAL_MS) void fetchOne(address);
    }
  }, [enabled, active, key, tick, fetchOne]);

  const reload = useCallback((address?: string) => {
    for (const target of address ? [address] : key.split(",").filter(Boolean)) void fetchOne(target);
  }, [key, fetchOne]);

  const observations = useMemo<Observation[]>(
    () => addresses.flatMap((wallet) => (entries[wallet]?.data?.activity ?? []).map((item) => ({ wallet, item }))),
    [entries, addresses],
  );
  const newest = useMemo(() => sortNewestFirst(observations), [observations]);

  return { entries, observations, newest, reload };
}
