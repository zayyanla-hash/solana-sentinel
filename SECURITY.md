# Security Policy

## Product posture

This repository is a **research / paper-trading** platform. Live trade broadcast is disabled by multiple independent gates.

## Never commit

- Seed phrases, private keys, keypair JSON
- API keys, Supabase service role keys, wallet secrets
- `.env`, `.env.local`, or credential dumps

Use `.env.example` as the only committed env template. Secret scanning: `.gitleaks.toml` (gitleaks in CI) plus `scripts/secret-scan.sh` (pattern scan, including markdown).

## Trust boundaries

| Boundary | Rule |
|----------|------|
| Browser | No private keys; server actions only |
| LLM / research agent | No secrets in prompts; cannot execute or override engines |
| External metadata / social / web | UNTRUSTED; injection-sanitized |
| Execution provider | Quote + plan only; `canBroadcast` always `false` |
| Policy / risk / token-risk | Deterministic; LLM cannot bypass |
| Local HTTP API | GET `/api/state` is read-only. POST mutations: CSRF/origin check; if `SAT_BIND_HOST` is not loopback, `SAT_API_TOKEN` Bearer is required. `PUBLIC_DEMO=true` blocks anonymous mutations even on loopback. Do not expose an unauthenticated mutable API. |

## Bind / remote demo

- Default: `next dev --hostname 127.0.0.1` (loopback only)
- Remote demo: `pnpm --filter @sat/web run dev:remote-demo` binds `0.0.0.0:4317` and **must** set `SAT_API_TOKEN` and `SAT_ALLOWED_ORIGINS`. Requests without a valid Bearer token are rejected (401). Missing Origin on a non-loopback Host is rejected (403).

## Reporting

If you find a credential leak or safety bypass, rotate keys immediately and open a private report to the maintainers.
