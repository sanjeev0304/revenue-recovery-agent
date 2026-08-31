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

## The eval replays a pinned LLM cache

Gemini at `temperature: 0` is not deterministic. Three eval runs over identical code and
identical data produced agent-arm recoveries of 615, 712 and 723; the last two differed by
11 payments with every deterministic arm bit-identical. EVAL-PLAN requires a fixed seed to
produce identical numbers, and a live model call cannot satisfy that.

The 33 diagnoses the model produces for the 33 distinct error signatures are therefore
cached to `scripts/eval/llm-cache.json` and replayed. The cache is committed, so the eval is
reproducible for anyone who clones the repo, and a full run costs zero API calls.

The cache records the model it was built with and refuses to replay under a different model
name, since attributing one model's answers to another would be a misattribution rather than
a reproduction. `--refresh-llm-cache` rebuilds it from live calls.

What this buys is reproducibility, not certainty. **The pinned run is one draw from a
distribution whose spread is about 11 payments**, and that is stated in EVAL-PLAN next to
the numbers rather than left for a reviewer to discover by running it twice.

## The LLM classifier loses to majority-class guessing on the opaque subset

Reported because it was measured, not because it flatters the build.

On the 1100 record train split, the opaque subset is 319 records. Majority-class guessing —
always predict `OPAQUE_BANK_DECLINE` — scores 174/319 (54.5%). The Gemini classifier scores
154/319 (48.3%).

**The finding is a classification result, not a recovery result, and the two have very
different strengths.**

*Classification: the finding holds.* The gap is 18 to 20 records across three runs
(174 against 156, then 174 against 154). It is stable, it is larger than the run-to-run
movement, and it reproduces.

*Recovery: the two arms are indistinguishable at this sample size.* The majority arm
recovers 726/1100 and the agent 723/1100, a gap of 3. The LLM arm moved by 11 payments
between two runs of identical code on identical data, so a 3 payment gap sits inside the
noise. An earlier run showed a 14 payment gap in the same direction, which is why this is
recorded as "cannot be distinguished" rather than as either arm winning. Claiming the
majority arm recovers more money would be reading a difference smaller than the
measurement error.

**Scope matters and is stated deliberately.** This is a finding about the classifier on one
subset, not about the agent. The deterministic taxonomy resolves 781 of 1100 records, which
neither arm touches, and the headline result rests on that layer plus the policy engine:
baseline 246/1100 (22.4%) to agent 723/1100 (65.7%). "Guessing beats AI" would be a
misreading.

The control was audited before the result was accepted. The majority arm substitutes only
where `classify()` returns `needs_llm`, inherits the deterministic label everywhere else,
and relabels zero records the taxonomy could have resolved. All 319 substituted records
carry an opaque gateway reason. Had it been overriding deterministic causes it would have
been a bug in the arm rather than a finding, which is why it was checked.

The failure is specific rather than general, and the split is the explanation: 152/174
(87.4%) on genuinely opaque records against 2/145 (1.4%) on masked ones. The model
recognises a real opaque decline nearly nine times in ten and essentially never detects a
masked cause, so its aggregate sits below a constant guess purely because the masked half
drags it there. The model recognises a real opaque decline and almost never
spots a masked cause. The masked-in-burst cell is 0/46, which is unsurprising while the
burst feature is defined but not yet computed into the prompt — that cell says nothing about
the model yet.

The LLM stays in the pipeline. Building it, measuring it against a fair control, and finding
it wanting is a result; deleting it would leave the question unanswered and the eval with
nothing to say about whether the model earns its place.

## Transient retries belong inside each write, not around the composite

Five records in the full train batch errored and left an `Action` row stuck in `executing`.
Each had exactly one action, and its audit row still carried the pre-execution reasoning
rather than the result, so `closeAction` had never run. Two of the five were already
`recovered`, which places the failure after the executor succeeded.

The cause was retry granularity. `retryTransient` wrapped the whole of `executeDecision`,
which is not idempotent: `openAction` creates a row with a unique `idempotencyKey`. A
transient Neon disconnect during `closeAction` therefore retried the entire sequence,
`openAction` raised P2002 on the key it had just written, P2002 is correctly classified as
non-transient, and the record was abandoned mid-flight.

Retries now sit inside each store operation, so a failed `closeAction` retries only
`closeAction`. `openAction` additionally returns the existing row instead of colliding, so
the composite is idempotent even if something above it does retry.

The five stuck rows were closed out as `failed` with an `orphaned` outcome rather than
deleted, since an audit trail that quietly loses its failures is worse than one that records
them.

## QUIET_HOURS defers a contact rather than cancelling it

The guardrail vetoed any nudge falling between 21:00 and 09:00 customer-local, and a veto
ended the payment's playbook. On the train split that was 262 of 293 agent vetoes: the
overwhelming majority of blocked actions were blocked because of the hour, not because the
action was wrong.

POLICY-SPEC never intended that. Quiet hours exist so a customer is not messaged at 2am,
not so a payment is abandoned because its nudge happened to fall due overnight. "Not now"
was being implemented as "never".

Contacts are now deferred at scheduling time. The policy engine moves a `send_nudge` that
would land in quiet hours forward to 09:00 customer-local and records `deferredFrom` on the
action so the timeline shows what happened. The guardrail is kept unchanged as a backstop
that should now never fire, which is what keeps EVAL-PLAN's zero-violations requirement a
measurement rather than an assumption.

Only `send_nudge` defers. A payment link disturbs nobody at 02:00.

Measured on the 1100 record train split:

| | before | after |
|---|---|---|
| recovered, LLM off | 509/1100 (46.3%) | 567/1100 (51.5%) |
| recovered, LLM on | 615/1100 (55.9%) | 723/1100 (65.7%) |
| vetoes, LLM off | 130 | 31 |
| vetoes, LLM on | 272 | 54 |
| contacts sent, LLM on | 239 | 500 |

## Contact interventions are scored on a response horizon, not on timing

`oracleAllows` originally required every intervention to occur at or after the oracle's
`afterMs` before it could succeed. That is correct for `retry_charge` — retrying before the
customer's funds arrive genuinely fails, and the 18h floor on `INSUFFICIENT_FUNDS` depends
on it. It was wrong for contact actions.

A payment link issued at t=0 that the customer pays at t=5h was scored as a failure, because
the *issuing* happened before the response window opened. That inverts the incentive: the
playbook is supposed to issue the link promptly, and prompt issuing was the thing being
penalised. `INSTRUMENT_INVALID` could never score at all — its oracle median is 9.6h while
the playbook issues at t=0 and nudges at +1h.

Contact actions now succeed if the customer's response moment, `failedAt + afterMs`, falls
within `CONTACT_RESPONSE_HORIZON_MS` (72h) of the contact. A contact that arrives after the
window already opened also succeeds, since the customer can act immediately. `retry_charge`
keeps the strict rule unchanged.

The 72h horizon is a declared modelling constant, not a measurement. It represents how long
a payment link or nudge plausibly stays live in the customer's attention.

**This raises the headline number and the change is visible, not absorbed.** On the 1100
record train split, with the LLM off in both runs so only the semantics differ:

| | before | after |
|---|---|---|
| recovered | 315/1100 (28.6%) | 509/1100 (46.3%) |
| INSTRUMENT_INVALID | 0/77 (0%) | 33/77 (43%) |
| CUSTOMER_ABANDONED | 34/220 (15%) | 139/220 (63%) |
| AUTH_FAILED | 30/143 (21%) | 82/143 (57%) |
| INSUFFICIENT_FUNDS | 124/209 (59%) | 128/209 (61%) |
| GATEWAY_DOWNTIME | 46/68 (68%) | 46/68 (68%) |

The two pure-retry causes are bit-identical before and after, which is the check that the
change is scoped to contacts. `INSUFFICIENT_FUNDS` moves by four records because its
playbook ends in a nudge, so it is partly contact-driven; that is the expected shape of the
change rather than leakage into the retry rule.

Nearly two thirds of the headline lift comes from this one semantic change. Anyone reading
the recovery number should know that, which is why it is recorded with figures rather than
described.

## Razorpay Subscriptions were investigated and rejected

Subscriptions looked like the one path to a genuinely closed loop in test mode: our agent
decides to retry, Razorpay charges a live mandate, Razorpay reports the outcome back by
webhook. It was examined and does not work, for two independent reasons.

**Activation requires a Checkout browser transaction.** A subscription is created in the
`created` state and becomes `active` only after an authorisation payment made through
Razorpay Checkout with `subscription_id` passed in the options. The docs give no API-only
route to activation. In test mode the authorisation uses a Razorpay test card, so no real
card and no real money are involved, but it remains a browser interaction rather than a
server call.

**The charge trigger is Dashboard-only.** This is the blocker that actually matters. Both
the test-mode "Charge this now" control and the `pending`-state "Attempt Charge" flow are
documented purely as Dashboard actions. The public Subscriptions API surface covers plans,
create, fetch, update, cancel, pause, resume, scheduled changes and offers — there is no
charge-now endpoint. So the agent cannot initiate the retry; a human clicking a button
would be, which is exactly the thing we would need to automate.

Razorpay's own scheduler does auto-charge active subscriptions and fires
`subscription.charged` and `subscription.pending` with no human involvement. That closes a
loop, but Razorpay's scheduler is the thing deciding to retry, not our policy engine, so it
demonstrates nothing about the agent.

**Scope of the check:** public documentation only. An undocumented or partner-only
charge-now endpoint is not ruled out, and confirming that would mean asking Razorpay
support. This is recorded so a reviewer wondering why subscriptions were not used for a
real mandate retry finds the reasoning rather than assuming the API went unexamined.

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

## The board derives its display status from actions, not from PaymentAttempt.status

The recovery board's status column and its header counters do not read
`PaymentAttempt.status`. They derive a display status from the payment's `Action` rows:

- `recovered` — `PaymentAttempt.status` is `recovered`
- `escalated` — a succeeded `escalate` action exists
- `in_progress` — any action or diagnosis exists and neither of the above holds
- `failed` — untouched by the agent

This is a workaround, not a design. The orchestrator only ever writes two payment
statuses: `recovered`, in `PrismaIngestRepo` when a charge outcome succeeds, and `failed`,
in `resetBatchState`. Nothing anywhere writes `in_progress`, `escalated`, or `abandoned`.
Read literally, the board's in-progress and escalated counters would sit at zero forever,
and a row would jump from `failed` straight to `recovered` with no intermediate state for
the time-warp demo to show — which is the one thing that screen exists to do.

The derivation is faithful to what actually happened: an escalation really is a succeeded
`escalate` action, and a payment with actions against it really is in progress. It needs no
backend change and it cannot drift, because it reads the same rows the timeline renders.

**The honest fix is worker-side and is not done.** `PaymentAttempt.status` should be a real
state machine driven by the orchestrator: `in_progress` when the first action is scheduled,
`escalated` when an escalate action executes, `abandoned` when a playbook exhausts with
terminal `stop` and nothing recovered. Until that exists, the enum in the Prisma schema
claims five states the system never reaches, and any consumer other than this dashboard —
a query, an export, an alert — would read those columns and get a wrong answer. The
dashboard papering over it does not make the column correct.
