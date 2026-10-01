export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Same-origin JSON request. GET without a payload, POST with one. Cookies are browser-managed. */
export async function api<T>(path: string, payload?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: payload === undefined ? "GET" : "POST",
      cache: "no-store",
      ...(payload === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    });
  } catch {
    throw new HttpError("Could not reach the server", 0, "NETWORK");
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body: fall through with an empty object.
  }
  if (!response.ok) {
    throw new HttpError(
      typeof data.error === "string" && data.error ? data.error : "Request failed",
      response.status,
      typeof data.code === "string" ? data.code : undefined,
    );
  }
  return data as T;
}

export const teamAction = <T = unknown>(action: string, data: unknown) =>
  api<T>(`/api/team/${action}`, data);

export const changeState = (action: string, data: Record<string, unknown>) =>
  api("/api/state", { action, ...data });
