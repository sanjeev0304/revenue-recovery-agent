# Data model

Postgres via Prisma. All money is `Int` in paise. All timestamps are UTC `DateTime`.

## Entities

### Customer
The payer. Minimal by design — this is not a CRM.

- `id`, `externalId`
- `timezone` (IANA string, needed for quiet hours)
- `optedOut` boolean
- `contactCount7d` is NOT stored; it is derived from `Action` rows

### PaymentAttempt
One attempt to collect money. The root object.

- `id`, `razorpayPaymentId`, `razorpayOrderId`
- `customerId`
- `amountPaise` Int
- `method` enum: card, upi (only these two — see EVAL-PLAN for why)
- `status` enum: failed, recovered, abandoned, escalated, in_progress
- `errorCode`, `errorDescription`, `errorSource`, `errorStep`, `errorReason` (raw from Razorpay)

`errorReason` is the primary classification signal. `errorCode` is only ever
`BAD_REQUEST_ERROR` or `GATEWAY_ERROR` and carries almost no information — do not
classify on it. Store all five fields verbatim; the audit trail needs the raw error.
- `failedAt`
- `attemptNumber` Int, `parentAttemptId` nullable self-relation for retry chains
- `isSynthetic` boolean
- `syntheticTrueCause` nullable — ground truth label, ONLY populated for synthetic records
- `evalSplit` nullable enum: train, holdout

The `syntheticTrueCause` and `evalSplit` fields exist so the eval harness can score
classification accuracy. Production code must never read them.

### Diagnosis
One per payment attempt. Immutable once written.

- `id`, `paymentAttemptId`
- `rootCause` enum (see POLICY-SPEC)
- `confidence` Float
- `classifier` enum: deterministic, llm
- `evidence` String[]
- `llmModel`, `llmRawResponse` nullable — kept for auditability
- `createdAt`

### Action
A proposed action, whether executed or vetoed.

- `id`, `paymentAttemptId`, `diagnosisId`
- `type` enum: retry_charge, issue_payment_link, send_nudge, escalate
- `status` enum: proposed, vetoed, scheduled, executing, succeeded, failed
- `scheduledFor` nullable
- `executedAt` nullable
- `idempotencyKey` unique
- `vetoedBy` nullable, `vetoReason` nullable
- `payload` Json — link URL, message body, retry parameters
- `outcome` Json nullable — what actually happened

### AuditLog
Append-only. Never updated in place except to attach the outcome to the row that
recorded the intent.

- `id`, `paymentAttemptId`, `actionId` nullable
- `event` enum: ingested, diagnosed, action_proposed, action_vetoed, action_executed,
  outcome_recorded, escalated
- `inputSnapshot` Json — the state the decision was made against
- `ruleFired` nullable String
- `reasoning` nullable String
- `occurredAt` — simulated clock time
- `wallClockAt` — real time, so demo runs are still traceable

Two timestamps because time-warp runs produce `occurredAt` values that are not real.
Keeping both means the audit trail is honest about what was simulated.

### EvalRun
One row per eval execution so results are reproducible and comparable.

- `id`, `startedAt`, `datasetVersion`, `splitName`
- `arm` enum: baseline, agent
- `metrics` Json
- `notes`

## Relationships

- Customer 1—N PaymentAttempt
- PaymentAttempt 1—1 Diagnosis
- PaymentAttempt 1—N Action
- PaymentAttempt 1—N AuditLog
- PaymentAttempt self-relation for retry chains via `parentAttemptId`

## Indexing

Index for the queries the dashboard and eval actually run:

- `PaymentAttempt(status, failedAt)` — recovery board
- `PaymentAttempt(evalSplit, isSynthetic)` — eval harness
- `Action(status, scheduledFor)` — the scheduler's pickup query
- `Action(idempotencyKey)` unique
- `AuditLog(paymentAttemptId, occurredAt)` — timeline render

## Rules

- Never store a raw API key, webhook secret, or full card number. Last four only, and
  only if actually needed for display.
- `amountPaise` is `Int`, never `Decimal`, never `Float`.
- Enums live in the Prisma schema and are re-exported through `packages/core/src/types.ts`
  so the pure layer does not import Prisma.
- Migrations: use `prisma db push` during the build window. Do not spend time on a
  migration history nobody will read.
