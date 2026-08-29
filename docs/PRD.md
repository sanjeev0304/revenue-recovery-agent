# PRD — Razorpay Revenue Recovery Agent

## Problem

A meaningful share of attempted payments fail for reasons that are recoverable. Most
merchants respond with a fixed retry loop: try again in an hour, try again tomorrow,
give up. This is wrong in both directions. It wastes attempts on failures that will
never succeed (risk declines, revoked mandates), and it gives up too early on failures
that would have succeeded with different timing or a different rail.

The cost is twofold: lost revenue, and customer irritation from pointless retries and
duplicate notifications.

## What this builds

An agent that treats each failed payment as a diagnosis problem before it is a retry
problem. For a batch of failed payments it will:

1. Determine the root cause of each failure
2. Select a recovery intervention appropriate to that root cause
3. Execute the intervention within hard operational limits
4. Record every decision in an auditable trail
5. Report measured recovery against a naive-retry baseline

## What this is not

- Not a fraud or risk product. Risk declines are escalated, never retried.
- Not a dunning email tool. Messaging is one intervention among several.
- Not a live-payments product. Test mode only.

## Users

**Primary — revenue operations at a mid-size merchant.** Wants recovered revenue without
having to trust a black box. Needs to see why each decision was made and to be able to
tighten the rules.

**Secondary — the customer whose payment failed.** Should not be retried into overdraft,
messaged at 2am, or contacted five times about one order.

## Core requirements

### R1 — Diagnosis
Every failed payment receives a root cause from a fixed taxonomy, a confidence score, and
the evidence used. Deterministic classification from Razorpay error codes runs first; the
LLM handles only the ambiguous residue. The LLM hit rate is a reported metric and should
stay under 15%.

### R2 — Policy
Each root cause maps to a playbook. Playbooks are declared as data, not code branches,
so they can be shown and edited in the UI. See `docs/POLICY-SPEC.md`.

### R3 — Guardrails
A separate pure module that can veto any proposed action. Every action is checked before
execution. A vetoed action is still logged with its veto reason. Guardrails cover attempt
caps, cooldowns, quiet hours, contact frequency, opt-out, permanent-failure blocks, and
idempotency.

### R4 — Execution
Four action types: retry the charge, issue a fresh payment link, send a customer nudge,
escalate to a human queue. Each is a separate executor behind a common interface.

### R5 — Audit
Append-only log. Each entry records the input state, the rule that fired, the model
reasoning if any, the action taken, and the outcome. Surfaced in the UI as a per-payment
timeline, not a raw log dump.

### R6 — Measurement
An eval harness runs a naive-retry baseline and the agent over the identical held-out
dataset and reports the metrics in `docs/EVAL-PLAN.md`.

### R7 — Simulated clock
A time-warp mode that compresses multi-day retry schedules into seconds so the full
recovery lifecycle is demonstrable in a short video. Real time in production, simulated
time in demo. The policy engine must be agnostic to which is running.

## Non-goals for this build window

- Real SMS or WhatsApp delivery. A mock channel adapter that logs is sufficient.
- Multi-tenant support. Single merchant.
- Authentication. The dashboard is open in the demo deployment.
- Live-mode anything.

## Success criteria

The submission is successful if a reviewer can:

1. Open the deployed dashboard and see a populated recovery board without any setup
2. Watch a batch process end to end in under 60 seconds using time-warp
3. Click into any payment and read the full decision chain
4. Read the metrics table and understand exactly what was measured and on what data
5. Open `packages/core/src/guardrails.ts` and see that money decisions are deterministic

## Schedule

| Date | Deliverable |
|---|---|
| 25 Aug | Repo scaffold, Prisma schema, env wiring, Razorpay test keys |
| 26 Aug | Synthetic data generator, 1500 records, UPI and cards only, train/holdout split |
| 27 Aug | Ingest: webhook handler with signature verification, batch importer |
| 28 Aug | Diagnosis engine, deterministic classifier plus LLM fallback |
| 29 Aug | Policy engine and guardrails, with tests |
| 30 Aug | Orchestrator, BullMQ queues, simulated clock |
| 31 Aug | Executors and audit trail; headless batch run works end to end |
| 1 Sep | Dashboard: recovery board and per-payment timeline |
| 2 Sep | Dashboard: metrics page, escalation queue, policy panel |
| 3 Sep | Eval run on held-out split. FEATURE FREEZE. Deploy web and worker. |
| 4 Sep | Demo video, README with metrics, architecture and decisions docs |
| 5 Sep | Submit |

3 Sep is the heaviest day and the least forgiving. If anything slips, cut dashboard
polish on 2 Sep, never the eval.

## Risks

**The synthetic dataset is the single point of failure.** Every reported number depends
on it. If the failure distribution is not defensible, the whole submission is weak and
it cannot be fixed on 3 Sep. Document the modelling assumptions in the generator itself.

**Gemini free-tier daily request caps.** A full eval batch that calls the LLM per record
will exhaust the quota mid-run. Mitigation: cache diagnosis by error-code signature, keep
LLM hit rate low, and make the eval resumable.

**Scope creep in the dashboard.** The UI is judged on whether it makes decisions legible,
not on how much it does. Three screens is enough.
