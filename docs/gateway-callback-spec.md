# Gateway callback specification — Phase 4 deliverable (IMPLEMENTED behind a flag)

> Status, Phase 4: IMPLEMENTED in `server/gateway.ts` + routes
> `POST /api/payments/gateway-intents`,
> `POST /api/payments/callback/:gateway`,
> `POST /api/payments/gateway-intents/:id/refund`,
> `GET /api/payments/reconciliation` — but DISABLED unless
> `AMAR_GATEWAY_CALLBACKS_ENABLED=true` AND the per-gateway callback
> secret is set. Live gateway verification stays UNVERIFIED (no real
> credentials exist in the sandbox); the code path is proven by unit
> tests (self-generated HMAC vectors, `tests/phase4.test.ts`) and a
> live HTTP proof with a dev-only test secret (Phase 4 report).
>
> The format-check-only endpoint is still NOT part of capture and is
> never consulted by it. Settlement still records an operator-supplied
> `gatewayTrxId` as opaque metadata only.

## What Phase 4 built (implements the spec below)

### 1. Server-to-server verification (never client-asserted)

- For every gateway payment, the server — not the browser, not the POS client —
  must confirm the transaction with the gateway's own API before any
  `PaymentIntent` moves to `captured`:
  - **bKash (tokenized checkout):** authenticate with app key/secret, then call
    the payment-status/query endpoint for the `paymentID` and confirm
    `transactionStatus === 'Completed'` and that the amount, currency (BDT),
    merchant invoice number, and payer match the intent exactly.
  - **Nagad:** verify the callback signature / checksum with the merchant
    private key and confirm the payment status through Nagad's verification
    endpoint before capture.
- A client-supplied `trxId` alone is never sufficient evidence of payment.

### 2. Callback endpoints (to be implemented in Phase 4)

- `POST /api/payments/callback/bkash` and `POST /api/payments/callback/nagad`,
  each of which must:
  1. Authenticate the callback (gateway signature / IP allowlist + shared
     secret, per the gateway's current documentation — re-check at build time,
     do not copy credentials from this document).
  2. Look up the `PaymentIntent` by the merchant reference (never by a
     client-supplied amount).
  3. Re-query the gateway (step 1) and only then transition the intent.
  4. Be idempotent: a repeated callback for the same gateway transaction
     must return the already-recorded outcome, never double-capture.
  5. Log the gateway transaction id, verified amount, and verification
     timestamp on the intent (`gatewayTrxId`, `details.verifiedAt`).

### 3. Failure and mismatch rules

- Amount mismatch, unknown merchant reference, failed signature, or a
  gateway status other than completed → intent stays `pending` (or moves to
  `failed` with the gateway's reason), the operator is told exactly why, and
  no sale is marked paid.
- Callbacks must be replay-safe and auditable: store the raw callback
  payload (minus secrets) in the intent's audit trail.

### 4. What must NOT happen

- No endpoint may return `valid: true` / "verified via gateway" on the basis
  of a string prefix, a format check, or a client assertion.
- No settlement, refund, or subscription-approval path may skip step 1.

## Until Phase 4 ships

Operators confirm mobile payments out-of-band (gateway app / SMS / merchant
dashboard) and record the `trxId` as a reference only. The POS must display
gateway payments as **unverified by the system** until Phase 4 verification
lands.

## Credentials checklist for LIVE gateway verification (owner step — UNVERIFIED)

Live verification is impossible without real merchant credentials, which
do not exist in this sandbox and must never be pasted into a report,
chat, or git. When the shop is ready:

- [ ] bKash merchant account: app key/secret + callback secret issued
      for the production callback URL; set `AMAR_BKASH_CALLBACK_SECRET`
      (≥16 chars) and `AMAR_GATEWAY_CALLBACKS_ENABLED=true`.
- [ ] Nagad merchant account: merchant private key / callback secret;
      set `AMAR_NAGAD_CALLBACK_SECRET` (≥16 chars).
- [ ] Register the callback URLs with each gateway:
      `https://<your-domain>/api/payments/callback/bkash` and
      `.../callback/nagad` (HTTPS only — gateways will not call HTTP).
- [ ] Sandbox drill first: create a gateway intent for a small amount,
      complete a sandbox payment, confirm the callback captures exactly
      once, replay the same callback and confirm `already_captured`
      (no double-capture), then refund and confirm the ledger matches.
- [ ] Run `GET /api/payments/reconciliation` and confirm zero
      mismatches before enabling gateway capture for real orders.
- [ ] Confirm the operator flow: a payment that fails signature or
      amount checks stays `pending` and is NEVER marked paid by hand
      from the format-check endpoint — that endpoint still returns
      `gatewayVerified: false` by design.
