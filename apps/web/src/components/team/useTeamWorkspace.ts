"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HttpError, api, teamAction } from "./api";
import { describeError } from "./status";
import type {
  ActivityResponse,
  MonitorHealth,
  Notice,
  Phase,
  Run,
  SignOutReason,
  StateSnapshot,
  TeamStatus,
} from "./types";

const POLL_MS = 15_000;
const SUCCESS_DISMISS_MS = 5_000;

type Errors = { state?: string; monitor?: string };

const messageOf = (error: unknown) =>
  error instanceof HttpError
    ? describeError(error.code, error.message)
    : error instanceof Error
      ? error.message
      : "Request failed";

/** Data and session layer for the team workspace. Nothing here touches storage, URLs or the console. */
export function useTeamWorkspace() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null);
  const [team, setTeam] = useState<TeamStatus | null>(null);
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [monitor, setMonitor] = useState<MonitorHealth | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("loading");
  const teamRef = useRef<TeamStatus | null>(null);
  const pendingRef = useRef<string | null>(null);
  const sequence = useRef(0);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Drop every piece of session data, including the one-time credential. */
  const endSession = useCallback(
    (reason: SignOutReason) => {
      sequence.current += 1; // ignore responses still in flight
      teamRef.current = null;
      setTeam(null);
      setState(null);
      setMonitor(null);
      setErrors({});
      setIssued(null);
      setNotice(null);
      setRefreshError(null);
      setLastSuccessAt(null);
      setSignOutReason(reason);
      changePhase("signedOut");
    },
    [changePhase],
  );

  const handleFailure = useCallback(
    (error: unknown) => {
      if (error instanceof HttpError && error.status === 401) {
        if (phaseRef.current !== "signedOut") endSession(phaseRef.current === "ready" ? "expired" : null);
        return;
      }
      setRefreshError(messageOf(error));
      if (!teamRef.current) changePhase("unavailable");
    },
    [changePhase, endSession],
  );

  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    setRefreshing(true);
    try {
      const status = await api<TeamStatus>("/api/team/status");
      const [snapshot, health] = await Promise.allSettled([
        api<StateSnapshot>("/api/state"),
        api<MonitorHealth>("/api/monitor"),
      ]);
      for (const result of [snapshot, health]) {
        if (result.status === "rejected" && result.reason instanceof HttpError && result.reason.status === 401) {
          throw result.reason;
        }
      }
      if (ticket !== sequence.current) return;
      const next: Errors = {};
      teamRef.current = status;
      setTeam(status);
      if (snapshot.status === "fulfilled") setState(snapshot.value);
      else next.state = messageOf(snapshot.reason);
      if (health.status === "fulfilled") setMonitor(health.value);
      else next.monitor = messageOf(health.reason);
      setErrors(next);
      setLastSuccessAt(Date.now());
      setRefreshError(null);
      setSignOutReason(null);
      changePhase("ready");
    } catch (error) {
      if (ticket === sequence.current) handleFailure(error);
    } finally {
      if (ticket === sequence.current) setRefreshing(false);
    }
  }, [changePhase, handleFailure]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden && phaseRef.current !== "signedOut") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden && phaseRef.current !== "signedOut") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (notice?.tone !== "success") return;
    const timer = setTimeout(() => setNotice(null), SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const run: Run = useCallback(
    async (key, action, success, scope) => {
      if (pendingRef.current) return false;
      pendingRef.current = key;
      setPending(key);
      setNotice(null);
      try {
        await action();
        await refresh();
        if (success && phaseRef.current === "ready") setNotice({ tone: "success", text: success, scope });
        return true;
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) endSession("expired");
        else setNotice({ tone: "error", text: messageOf(error), scope });
        return false;
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [endSession, refresh],
  );

  /** Returns an error sentence, or null on success. The credential never leaves this call. */
  const signIn = useCallback(
    async (username: string, credential: string): Promise<string | null> => {
      if (pendingRef.current) return null;
      pendingRef.current = "signin";
      setPending("signin");
      try {
        await teamAction("login", { username, credential });
        await refresh();
        return phaseRef.current === "ready" ? null : "Sign-in did not complete. Try again.";
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) return "Those credentials were not accepted.";
        if (error instanceof HttpError && error.status === 429) return "Too many attempts — wait a minute.";
        return messageOf(error);
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    // Never blocked by an in-flight action: signing out must always take effect.
    setPending("signout");
    try {
      await teamAction("logout", {});
      endSession("signedOut");
    } catch (error) {
      // A 401 means the server already ended the session. Anything else leaves the session cookie valid,
      // so keep the workspace and say so rather than appearing signed out.
      if (error instanceof HttpError && error.status === 401) endSession("signedOut");
      else setNotice({ tone: "error", text: `Sign out did not complete: ${messageOf(error)} Try again.` });
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }, [endSession]);

  const generateCredential = useCallback(
    (username: string) =>
      run(
        "team:member",
        async () => {
          const result = await api<{ credential: string }>("/api/team/member", { username });
          setIssued(result.credential);
        },
        "Credential generated",
        "team",
      ),
    [run],
  );

  const loadActivity = useCallback(
    async (wallet: string) => {
      try {
        return await api<ActivityResponse>(`/api/team/activity?wallet=${encodeURIComponent(wallet)}`);
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) endSession("expired");
        throw error;
      }
    },
    [endSession],
  );

  return {
    phase, signOutReason, team, state, monitor, errors, lastSuccessAt, refreshError, refreshing,
    pending, notice, issued,
    refresh, run, signIn, signOut, generateCredential, loadActivity,
    hideIssued: () => setIssued(null),
    dismissNotice: () => setNotice(null),
  };
}

export { messageOf };
