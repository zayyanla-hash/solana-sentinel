import type { AlertEvent } from "@sat/shared";

export type TelegramSendResult =
  | { kind: "sent"; messageId: number }
  | { kind: "retry"; reason: string; retryAfterSeconds?: number }
  | { kind: "failed"; reason: string }
  | { kind: "uncertain"; reason: string };

export function formatTelegramAlert(event: AlertEvent): string {
  const title = event.title.replace(/\p{Cc}/gu, " ").slice(0, 200);
  const body = event.body.replace(/\p{Cc}/gu, " ").slice(0, 3500);
  return `${title}\n\n${body}\n\nEvent ID: ${event.id}`;
}

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!/^[0-9]{4,20}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("TELEGRAM_TOKEN_INVALID");
  }

  /** Check a bot token without sending a message or exposing Telegram's response text. */
  async verifyBot(): Promise<{ id: number; username: string }> {
    let response: Response;
    try {
      response = await this.request(`https://api.telegram.org/bot${this.token}/getMe`, {
        method: "POST", signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new Error("TELEGRAM_VERIFY_UNAVAILABLE"); }
    if (response.status === 401 || response.status === 403) throw new Error("BOT_TOKEN_REJECTED");
    if (!response.ok) throw new Error("TELEGRAM_VERIFY_UNAVAILABLE");
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error("TELEGRAM_VERIFY_UNAVAILABLE"); }
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const bot = body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {};
    const id = Number(bot.id);
    if (body.ok !== true || bot.is_bot !== true || !Number.isSafeInteger(id) || id < 1 ||
        typeof bot.username !== "string" || !/^[A-Za-z0-9_]{4,64}$/.test(bot.username)) {
      throw new Error("TELEGRAM_VERIFY_INVALID_RESPONSE");
    }
    return { id, username: bot.username };
  }

  async sendText(chatId: string, text: string): Promise<TelegramSendResult> {
    if (!/^-?[0-9]{1,20}$/.test(chatId)) return { kind: "failed", reason: "CHAT_ID_INVALID" };
    if (!text || text.length > 4096) return { kind: "failed", reason: "MESSAGE_INVALID" };
    let response: Response;
    try {
      response = await this.request(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // A timed-out HTTP request may have reached Telegram. Explicit review is required.
      return { kind: "uncertain", reason: "SEND_OUTCOME_UNKNOWN" };
    }
    let payload: unknown;
    try { payload = await response.json(); } catch {
      if (response.status === 429) return { kind: "retry", reason: "RATE_LIMITED", retryAfterSeconds: 60 };
      if (response.status === 401) return { kind: "failed", reason: "BOT_TOKEN_REJECTED" };
      if (response.status === 403) return { kind: "failed", reason: "DESTINATION_FORBIDDEN" };
      if (response.status === 400) return { kind: "failed", reason: "DESTINATION_OR_MESSAGE_REJECTED" };
      return { kind: "uncertain", reason: "RESPONSE_UNREADABLE" };
    }
    const result = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    if (response.ok && result.ok === true) {
      const message = result.result && typeof result.result === "object"
        ? result.result as Record<string, unknown> : {};
      const id = Number(message.message_id);
      if (Number.isSafeInteger(id) && id > 0) return { kind: "sent", messageId: id };
      return { kind: "uncertain", reason: "MESSAGE_ID_MISSING" };
    }
    if (response.status === 429) {
      const params = result.parameters && typeof result.parameters === "object"
        ? result.parameters as Record<string, unknown> : {};
      const seconds = Number(params.retry_after);
      return { kind: "retry", reason: "RATE_LIMITED",
        retryAfterSeconds: Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : 60 };
    }
    if (response.status === 401) return { kind: "failed", reason: "BOT_TOKEN_REJECTED" };
    if (response.status === 403) return { kind: "failed", reason: "DESTINATION_FORBIDDEN" };
    if (response.status === 400) return { kind: "failed", reason: "DESTINATION_OR_MESSAGE_REJECTED" };
    if (response.status >= 500) return { kind: "uncertain", reason: "TELEGRAM_SERVER_OUTCOME_UNKNOWN" };
    return { kind: "failed", reason: `TELEGRAM_HTTP_${response.status}` };
  }

  async sendVerificationChallenge(chatId: string, challenge: string): Promise<TelegramSendResult> {
    if (!/^[0-9]{6}$/.test(challenge)) return { kind: "failed", reason: "CODE_INVALID" };
    return this.sendText(chatId, `Solana Sentinel verification code: ${challenge}\nExpires in 10 minutes. Enter it only in your Sentinel setup screen.`);
  }

  async sendAlert(chatId: string, event: AlertEvent): Promise<TelegramSendResult> {
    return this.sendText(chatId, formatTelegramAlert(event));
  }
}
