# Revenue Recovery Agent

Razorpay AI Buildathon — Track 03, AI Revenue Recovery

An agent that diagnoses why a payment failed before deciding how to recover it, executes a
bounded workflow, and reports measured recovery against a naive-retry baseline on data it
had never seen.

---

## Results

Measured on a 400-record holdout split, sealed from the start of the project and read
exactly once, on 31 Aug 2026. Nothing was tuned after reading it.

| | baseline | agent | change |
|---|---|---|---|
| payments recovered | 91/400 (22.8%) | **255/400 (63.8%)** | +164 |
| money recovered | ₹1,95,586 | **₹11,51,980** | +₹9,56,394 |
| charge attempts | 1,101 | 316 | −785 |
| wasted attempts | 765 | 103 | −662 |
| attempts per recovery | 12.1 | 1.24 | — |
| risk declines retried | 0 | 0 | — |
| quiet-hours violations | 0 | 0 | — |

Value at risk was ₹19,10,725. The agent recovered 60% of it; the baseline recovered 10%.

The baseline is a fair implementation, not a strawman: fixed retries at +1h, +6h and +24h,
max 3 attempts, no diagnosis and no guardrails. It is what a competent team ships without
an agent.

**Train predicted 64.7%. Holdout delivered 63.8%.** That one-point gap is the result we
care about most — the system generalised to data it was never tuned against.

Per-class: 327/400 (81.8%) classification accuracy. RISK_DECLINE 16/16 precision and
recall. INSTRUMENT_INVALID, ISSUER_DOWNTIME, GATEWAY_DOWNTIME and TECHNICAL_UNRESOLVED all
at 100% precision. The weak cell is OPAQUE_BANK_DECLINE at 51% precision — the model
over-assigns it.

Cost-weighted: ₹12,939 forgone against an oracle that knew every true cause. Most
misclassifications cost nothing — confusing the two downtime classes recovers identically
because both playbooks retry. Errors are concentrated where errors are cheap.

---

## Read this before the results

Three limitations, stated up front because a reviewer should not have to find them.

**1. Recovery outcomes are simulated. The intake path is real.**

Razorpay webhooks arrive over a signature-verified endpoint, the failure taxonomy is built
from Razorpay's actual `reason` codes, and orders are created through the live test-mode
API. What is simulated is whether a retry *succeeded*.

This is not a shortcut. A server-initiated card retry requires a saved instrument or an
active mandate, which requires a real person authorising a real card. Synthetic customers
cannot do that. The Subscriptions path was investigated and rejected — activation needs a
Checkout browser transaction with no API-only route, and the charge trigger is
Dashboard-only. See `docs/DECISIONS.md`.

Outcomes therefore come from a ground-truth oracle generated with the dataset: for each
record, which interventions would have succeeded and after what delay, derived from the
cause rather than sampled independently. The system never sees it.

**2. Our test of whether the LLM added value was confounded, and we cannot claim a result.**

Diagnoses are cached by `method|reason|source|step`. Masking — where a record's true cause
is disguised behind an opaque reason — works by giving different causes the same signature.
So the cache collapsed 126 opaque holdout records into 29 distinct questions, and 97 of 126
records received a reused answer.

The per-record features we built specifically to make inference possible — amount, hour of
day, day of month, prior attempt count — influenced only 29 decisions. A per-signature
answer cannot separate masked from genuine records, by construction.

The apparent result (3.3% on masked records) therefore measures the caching strategy, not
the classifier. It cannot distinguish a weak model from an under-queried one. A corrected
experiment needs per-record calls with no signature caching, on a fresh split.

**3. The majority-class comparison is null, not a win for either side.**

A control arm that replaces every model call with the majority label recovered 255/400 —
identical to the agent. On the train split the gap was 3 payments, inside the 11-payment
run-to-run variance we measured across three runs. There is no distinguishable difference
at this sample size.

**What this means for the headline.** The recovery lift comes from the deterministic
diagnosis and policy layer, not from the model. The lookup table resolves 71% of failures
from Razorpay's reason codes; the playbooks, timing rules and guardrails do the rest. We
built an LLM classifier for the ambiguous remainder, measured it, and cannot show that it
helped.

---

## How it works

A failed payment is a diagnosis problem before it is a retry problem. Most retry systems
apply one schedule to every failure. That is wrong in both directions — it wastes attempts
on failures that can never succeed, and gives up early on ones that would have recovered
with different timing.

```
Failed payment  (webhook, HMAC verified — or batch import)
      ↓
Read the reason code
      ├── 71% → deterministic lookup, Razorpay reason → root cause
      └── 29% → Gemini Flash, label and confidence only
      ↓
Playbook — proposes one action, or none
      ↓
Guardrails — nine rules, first veto wins
      ├── blocked or deferred → logged with the rule that fired
      └── allowed
      ↓
Scheduled and executed — retry · payment link · nudge · escalate
      ├── Razorpay webhook (live)
      └── oracle (simulated)
      ↓
Outcome recorded → loop to next playbook step, within caps
      ↓
Audit trail — every decision, vetoes included
```

**Ten root causes**, mapped from Razorpay's real `reason` values. Classification uses
`reason` with `source` and `step` as supporting signals — never `code`, which only ever
holds `BAD_REQUEST_ERROR` or `GATEWAY_ERROR`.

**A playbook per cause.** Insufficient funds never retries inside 24 hours and shifts
toward salary-credit windows. Authentication failures never retry silently — the customer
must be present, so they get a link. Issuer downtime retries at +30m, +2h, +6h with no
customer contact, because it is not the customer's problem. Risk declines propose no charge
at all.

**Guardrails are pure functions that can veto anything.** Attempt caps, cooldowns, quiet
hours, contact caps, opt-out, permanent-failure blocks, idempotency, amount ceiling.
`packages/core` has no database access, no network, no `Date.now()` — time is a parameter.
A purity test enforces this rather than leaving it to review.

**The model never decides whether an action executes.** It returns a label and a
confidence. Every money-moving action passes through the same deterministic gate.

---

## The RISK_DECLINE path

Worth calling out, because it looks like a gap. Risk declines produce no guardrail veto in
any run — the playbook proposes no charge, so `PERMANENT_FAILURE_BLOCK` has nothing to veto.

That is stronger than a veto. The agent does not catch itself trying to retry a fraud
decline; it never considers it. The guardrail is unit-tested and stands as a backstop
against a future playbook change. The timeline states this explicitly rather than showing a
blank.

---

## Dataset

1,500 synthetic failed payments — 1,100 train, 400 holdout — generated with a seeded PRNG.

UPI and cards only. Netbanking and wallet reason codes were not verified against
Razorpay's docs, and inventing plausible-looking codes would undermine the dataset.

Every derivation is conditioned on the cause: risk declines recover under nothing,
insufficient funds cannot recover inside an 18-hour floor enforced by the distribution's
support rather than by chance. Feature correlations — amount, hour, day of month, prior
attempts — are specified numerically in `docs/EVAL-PLAN.md`.

A deliberate high-value tail was injected so the amount-ceiling guardrail is reachable; the
natural lognormal draw put ₹5,00,000 about 4.3σ out and never produced one across 1,500
records. Documented as an injection, not a natural draw.

**One circularity we planted and then rewarded:** the policy engine's salary-window retry
rule targets the same window the generator plants funds-arrival in. That rule's measured
benefit is partly an artefact of our own assumption about Indian salary cycles. The
assumption is defensible; assuming it and rewarding it is worth stating.

---

## Reproducibility

```
cp .env.example .env  # then fill it in, see below
npm install
npm run db:push       # creates the schema and generates the Prisma client
npm run seed          # 1,500 records, seeded, deterministic
npm run eval          # baseline, agent, agent LLM-off, majority class
```

**Required to reproduce the eval:**

- `DATABASE_URL` — Postgres. The dataset lives here and every arm reads it.
- `GEMINI_API_KEY` — only for `--refresh-llm-cache`. The committed cache in
  `scripts/eval/llm-cache.json` is replayed by default, so a normal `npm run eval` makes
  zero API calls. The key must still be set: `scripts/eval` refuses to start without one
  rather than silently skipping the LLM arm. Any non-empty value works for a cached replay.

**Only needed for the live worker**, not for the eval:

- `REDIS_URL` — BullMQ queues for scheduled retries.
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` — the ingest webhook
  and the Razorpay adapter. Test mode only; the worker refuses to boot on a key that is not
  `rzp_test_` prefixed.

`npm test` needs none of them — 251 unit tests run with no database and no network.

`npm run eval` writes `docs/results.md` and `docs/results.json`. The metrics screen reads
that file; no figure in this README was typed by hand.

Gemini at `temperature: 0` is **not** deterministic — three runs of identical code gave
615, 712 and 723 on the train split. The 33 LLM diagnoses are therefore cached to
`scripts/eval/llm-cache.json` and replayed, making the eval byte-identical across runs. The
cache records the model it was built with and refuses to replay under a different one.
The pinned numbers are one draw from a distribution roughly 11 payments wide.

---

## Dashboard

Three screens.

**Recovery board** — live payment state, filterable by status and cause, polling every 1.5s.
Rows flash as they change so a full recovery lifecycle is watchable. The board has no warp
control of its own: time-warp is configured on the worker at boot via `WARP_ORIGIN` and
`WARP_FACTOR`, which compress multi-day retry schedules into seconds, and the board simply
displays the resulting run as it happens. Its counters are labelled as a demo run and are
not the measured result.

**Payment timeline** — the full decision chain for one payment: raw Razorpay error →
diagnosis with confidence, classifier and numbered evidence → playbook with its caps →
each action with its guardrail verdict → outcome. Vetoed actions keep their slot, struck
through, with the rule that blocked them.

**Metrics** — the four arms, the cost-weighted confusion matrix, and the limitations above.

---

## Stack

npm workspaces · Next.js 15 · TypeScript strict · Prisma + Postgres (Neon) · BullMQ + Redis
· Fastify worker · Gemini Flash behind an `LLMProvider` interface

```
apps/web        dashboard
apps/worker     ingest, orchestrator, executors
packages/core   diagnosis, policy, guardrails — pure, zod its only dependency
packages/db     Prisma schema
scripts/seed    dataset generator
scripts/eval    the only thing that reads the holdout
docs/           PRD, POLICY-SPEC, DATA-MODEL, EVAL-PLAN, DECISIONS, results
```

251 tests. Guardrails and playbook timing are mutation-tested — each invariant was
deliberately broken to confirm the suite catches it.

---

## Docs

- `docs/PRD.md` — requirements and scope
- `docs/POLICY-SPEC.md` — taxonomy, playbooks, guardrails. Source of truth; code matches it
- `docs/DATA-MODEL.md` — schema and its rules
- `docs/EVAL-PLAN.md` — dataset construction, metrics, and how to read them
- `docs/DECISIONS.md` — every judgment call, including the ones that went against us
- `docs/results.md` — the holdout run
