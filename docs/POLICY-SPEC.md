# Policy specification

Source of truth for diagnosis, playbooks, and guardrails. Code must match this document.
To change behaviour, change this first.

Error codes below are taken from Razorpay's official docs:
- https://razorpay.com/docs/errors/payments/cards/
- https://razorpay.com/docs/errors/payments/upi/
- https://razorpay.com/docs/errors/payments/payment-methods-error-parameters/

## Reading a Razorpay error

The error object contains `code`, `description`, `field`, `source`, `step`, `reason`
and `metadata`.

- `code` is coarse: `BAD_REQUEST_ERROR` or `GATEWAY_ERROR`. Do not classify on this.
- `reason` is the granular failure cause. This is the primary classification signal.
- `source` tells you who is responsible: customer, bank, gateway, razorpay, network.
- `step` tells you where in the flow it broke: payment_initiation,
  payment_authentication, payment_authorization.

Classify on `reason` first, using `source` and `step` to disambiguate where the same
reason appears under different methods.

## Root cause taxonomy

| Root cause | Razorpay `reason` values | Recoverable | Retry the charge? |
|---|---|---|---|
| `INSUFFICIENT_FUNDS` | `insufficient_funds` | Yes, with timing | Yes, delayed only |
| `TRANSACTION_LIMIT_EXCEEDED` | `transaction_limit_exceeded` | Yes, on daily reset | Yes, next day only |
| `AUTH_FAILED` | `authentication_failed`, `incorrect_cvv` | Yes | No, needs customer present |
| `CUSTOMER_ABANDONED` | `payment_cancelled`, `payment_timed_out`, `payment_collect_request_expired` | Yes | No, needs customer present |
| `ISSUER_DOWNTIME` | `bank_technical_error` | Yes | Yes |
| `GATEWAY_DOWNTIME` | `gateway_technical_error` | Yes | Yes |
| `INSTRUMENT_INVALID` | `card_expired`, `debit_instrument_blocked`, `debit_instrument_inactive`, `card_not_enrolled`, `card_disabled_for_online_payments`, `invalid_vpa` | Only with a new instrument | Never |
| `RISK_DECLINE` | `payment_risk_check_failed` | No | Never |
| `OPAQUE_BANK_DECLINE` | `card_declined`, `payment_failed`, `payment_declined` | Unclear | Once, cautiously |
| `TECHNICAL_UNRESOLVED` | `vpa_resolution_failed`, `credit_failed` | Unclear | No, escalate |
| `UNKNOWN` | anything unmapped | Unclear | No |

Notes that matter:

- `payment_timed_out` is NOT a network error. Per Razorpay's docs it means the customer
  exceeded the payment window, typically 10 minutes. Treat it as abandonment.
- `bank_technical_error` is the customer's bank being down. `gateway_technical_error` is
  Razorpay's partner bank being down. Different recovery windows, so keep them separate.
- `transaction_limit_exceeded` is its own root cause. It resembles `INSUFFICIENT_FUNDS`
  but recovers on a daily limit reset rather than a funds credit, so it gets its own
  retry timing: next day, once. Kept separate because the recovery trigger differs.
- `OPAQUE_BANK_DECLINE` is the interesting class. Razorpay's own docs say they often do
  not have the underlying reason because banks do not share it. This is where the LLM
  earns its place: infer the likely cause from amount, method, time of day, and the
  customer's prior attempt history. Report accuracy on this class separately.
- Anything unmapped goes to `UNKNOWN` and gets classified by the LLM. Never guess a
  mapping in code.

## Playbooks

One playbook per root cause, declared as data.

### INSUFFICIENT_FUNDS
- No retry within 24h. Immediate retries never work and irritate the customer.
- Retry at +24h, then +72h.
- If the next salary-credit window (1st or last working day of month) falls within 5 days,
  schedule the second attempt for that window instead.
- Max 2 retries. Then one nudge with a payment link. Then stop.
- Nudge at +24h after the final retry, roughly four days after the original failure, which
  spans most short-term cash gaps. This timing is paced on a different axis from the other
  nudges: those are spaced so the message does not read as aggressive, this one is spaced
  to when the money is likely to be there. Asking someone to pay while their balance is
  still short only produces another visible failure.
- Open question, not yet implemented: the salary-window adjustment applied to the second
  retry should probably apply to the nudge too. Today the nudge is a flat +24h after the
  last action, so it inherits the window only when the retry itself was shifted onto one.
  A payment that took the +48h fallback can still land its nudge just before a salary
  credit that a re-anchored nudge would have waited for.

### TRANSACTION_LIMIT_EXCEEDED
- The instrument works and the funds exist. Only the daily limit was hit.
- No retry before the limit resets. Retry once at the next local-midnight boundary
  plus a small offset, so the attempt lands after the reset rather than on it.
- Max 1 retry. If it fails, one nudge suggesting a different instrument, then escalate.
- Nudge at +12h after the failed retry: the retry already waited out the limit reset, so
  the customer has been waiting a day and 12h lands the message in the same waking day
  without arriving on the heels of the retry.
- No same-day retry under any circumstance. A second same-day attempt cannot succeed.

### AUTH_FAILED
- Never retry silently. The customer must be present to complete authentication.
- Issue a fresh payment link immediately.
- One nudge at +2h after the link. Copy should suggest UPI as an alternative to card plus
  OTP. The customer just failed an OTP and knows the payment did not go through, so a
  reminder inside the quarter hour reads as nagging rather than as help.
- Max 1 link, max 1 nudge, then escalate.

### CUSTOMER_ABANDONED
- Never retry silently.
- Issue a fresh payment link.
- One nudge scheduled at +2h. Immediate contact reads as aggressive.
- If no action within 24h, one final nudge, then escalate.
- Max 2 contacts.

### ISSUER_DOWNTIME
- Retry at +30m, +2h, +6h.
- No customer contact. This is not their fault and messaging them adds nothing.
- If all three fail, re-diagnose rather than continuing to retry.
- Max 3 retries.

### GATEWAY_DOWNTIME
- Retry at +15m, +1h, +4h. Shorter windows than issuer downtime, since partner bank
  issues typically resolve faster.
- No customer contact.
- Max 3 retries.

### INSTRUMENT_INVALID
- Never retry the charge. The instrument cannot work.
- One nudge at +1h after the link, asking for an updated payment method. Five minutes
  after a rejected card reads as automated; an hour reads as a merchant noticing. Shorter
  than AUTH_FAILED because nothing resolves here without the customer acting.
- Escalate after the nudge regardless of outcome.

### RISK_DECLINE
- No retry. No customer contact. Escalate immediately.
- Enforced in guardrails, not only in the playbook.

### OPAQUE_BANK_DECLINE
- One retry at +6h. Banks often decline transiently and succeed later.
- If it fails, one nudge suggesting an alternate method.
- Max 1 retry, max 1 contact, then escalate.

### TECHNICAL_UNRESOLVED
- No retry. Razorpay's own guidance is to raise a support ticket for these.
- Escalate immediately with the raw error attached.

### UNKNOWN
- If LLM confidence is 0.6 or above, follow the predicted cause's playbook with all
  retry caps halved.
- If confidence is below 0.6, escalate without acting.

## Guardrails

Run after the playbook proposes an action. Can veto. A vetoed action is logged with its
reason and never executed. Pure functions, tested independently.

| Guardrail | Rule |
|---|---|
| `PERMANENT_FAILURE_BLOCK` | If cause is `RISK_DECLINE`, `INSTRUMENT_INVALID`, or `TECHNICAL_UNRESOLVED`, veto every charge retry |
| `GLOBAL_ATTEMPT_CAP` | Max 3 charge attempts per payment across all playbooks, ever |
| `PLAYBOOK_ATTEMPT_CAP` | Enforce the per-playbook cap declared above |
| `COOLDOWN` | Veto any charge attempt inside the playbook's minimum interval since the last attempt |
| `QUIET_HOURS` | Veto customer contact between 21:00 and 09:00 customer-local. Charge retries exempt, they are silent |
| `CONTACT_CAP` | Max 2 contacts per payment; max 3 per customer per rolling 7 days across all payments |
| `OPT_OUT` | If the customer opted out, veto all contact. Charge retries still allowed |
| `IDEMPOTENCY` | Every executed action carries a deterministic key. Duplicate key is vetoed |
| `AMOUNT_CEILING` | Veto automatic retry above a configured amount, escalate instead. Default 50000000 paise |

`CONTACT_CAP` counts `send_nudge` actions only. `issue_payment_link` is not a contact:
it mints a URL, it does not message anybody. Counting it would put the
`CUSTOMER_ABANDONED` playbook — link, nudge at +2h, final nudge — at three contacts and
in breach of its own two-contact cap on the exact steps this document prescribes.

Guardrails evaluate in the order listed. First veto wins and short-circuits.

## Decision output shape

Produced for every payment whether or not an action results:

```
{
  paymentId
  rootCause
  confidence
  classifier: "deterministic" | "llm"
  razorpayReason
  razorpaySource
  razorpayStep
  proposedAction: Action | null
  guardrailVerdict: { allowed: boolean, vetoedBy: string | null, reason: string }
  scheduledFor: timestamp | null
  evidence: string[]
}
```

This is what the audit trail stores and what the per-payment timeline renders. Never
produce an action without a corresponding decision record.

## Baseline definition

Implemented in `scripts/eval`, used as the comparison arm:

- Retry every failed payment regardless of root cause
- Fixed schedule: +1h, +6h, +24h
- Max 3 attempts
- No diagnosis, no guardrails, no customer contact

This is a fair representation of what a competent team ships without an agent. Do not
weaken it to flatter the results.
