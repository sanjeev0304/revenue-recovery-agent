# Decisions

Deliberate trades made during the build. Each entry records what was chosen, what was
given up, and why — so a reviewer can tell a considered trade from an oversight.

## The burst feature is prompt-only

`RecentFailureWindow` — merchant-wide failure count in a 20 minute window, its ratio
against a trailing baseline, and the share of those failures sharing this payment's method
and reason — is passed to the LLM in the diagnosis prompt. It is **not** used in
deterministic classification.

A threshold rule of roughly `ratio > 4` implies `ISSUER_DOWNTIME` or `GATEWAY_DOWNTIME`
would be better production engineering. It would be cheaper, faster, more reliable than a
model call, and it would cut the LLM hit rate by several points against a target the
project is already missing.

It was not done because it would move the two downtime classes out of the measured-inference
set entirely. They would become a lookup, and the eval would no longer say anything about
whether the model can use the signal. Keeping them in the LLM's hands costs quota and
accuracy but keeps the measurement honest.

This is a trade made for the integrity of the evaluation, not for the quality of the
production system. A real deployment should threshold it deterministically and skip the
model call.

## The burst signal is strong by construction

Related to the above, and stated so nobody reads the downtime numbers as harder-won than
they are: a payment failing alongside thirty others inside twenty minutes with an identical
gateway reason is **structurally identifiable, not inferred**. Downtime-class accuracy
measures whether the model can read an obvious signal. It should not carry the headline.

## Webhook replay defence is dedupe only

Razorpay's webhook signature covers the request body and nothing else. Unlike Stripe, there
is no timestamp inside the signed material, so a captured payload stays valid forever and
can be replayed indefinitely by anyone who obtains it.

The defence is deduplication on `x-razorpay-event-id`, enforced by a unique constraint on
`webhook_events.eventId`. A replayed delivery is stored once, acknowledged with 200, and
never reprocessed. When the header is absent the event id falls back to a SHA-256 of the
raw body, so dedupe still has a key.

A timestamp window on the payload's `created_at` was considered and rejected: `created_at`
is not covered by the signature, so an attacker replaying a payload can edit it freely,
and a legitimate Razorpay retry storm after an outage would be dropped by the window. It
would add the appearance of replay protection without the substance.

This is a limitation of the provider's signature scheme, not something the endpoint can
fix. It is recorded so nobody assumes replay protection exists that does not.

## The webhook never creates payments

An event for a payment this system does not recognise is persisted, acknowledged with 200,
and marked `unmatched`. It is not an error and must never trigger a Razorpay retry: test
mode delivers events for payments other integrations created, and an endpoint that threw on
them would fail during the demo.

The consequence is that `payment.failed` does **not** create a new `PaymentAttempt`. In a
production system it would — that is how failed payments enter. Here payments enter only
through the batch importer, because creating records from arbitrary test-mode traffic would
put rows with no ground-truth labels into the dataset the eval measures.

## Server-initiated retry is approximated

`RazorpayAdapter.attemptCharge` creates an Order through the live test-mode API and returns
its id as the provider ref. It does not re-present the original instrument.

A true server-initiated retry needs a saved token or an active mandate, neither of which
exists for a synthetic dataset and neither of which can be created without a real customer
completing an authorisation. The Order call is the closest test-mode analogue: it is a real
authenticated API call whose outcome arrives by webhook on the same path a genuine retry
would use.

The simulated arm is therefore the one that measures recovery. The Razorpay arm demonstrates
that the ingest path is real, not that the retries are.

## RISK_DECLINE is never masked

Opaque masking applies to every cause except `RISK_DECLINE`. Masking it would put risk
declines in the dataset that cannot be deterministically identified, so the agent would
retry payments it must never retry, and the safety-critical recall metric would measure the
dataset rather than the guardrail.

The cost is realism: real banks do mask risk declines. We accept a less realistic dataset
in exchange for a recall number that means what it says.

## Cap halving is scoped to unmapped reasons

`POLICY-SPEC` places cap halving under the `UNKNOWN` heading. It is implemented for reasons
the taxonomy cannot map, not for every LLM classification. An opaque decline classified by
the model keeps its full caps. The broader reading was available and was not taken.

## A payment link is not a contact

`CONTACT_CAP` counts `send_nudge` only. Recorded in `POLICY-SPEC` under the guardrail table.

## Prisma is pinned to 6

Prisma 7 removed `url = env("DATABASE_URL")` from the schema and requires a
`prisma.config.ts` plus a driver adapter. That contradicts the `prisma db push` workflow
`DATA-MODEL.md` documents. Pinned to 6 for the build window; a later migration is a known
cost.
