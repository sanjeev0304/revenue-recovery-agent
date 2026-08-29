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
