# Razorpay Revenue Recovery Agent

An agent that diagnoses failed payments, chooses a bounded recovery action, executes it,
and reports measured money recovered against a naive-retry baseline.

Built for the Razorpay AI Buildathon, Track 03 (AI Revenue Recovery).
Build window: 25 Aug 2026 to 4 Sep 2026. Submission 5 Sep 2026.

Read `docs/PRD.md` before any task that touches product behaviour.
Read `docs/POLICY-SPEC.md` before touching diagnosis, policy, or guardrails.
Read `docs/DATA-MODEL.md` before touching the Prisma schema.
Read `docs/EVAL-PLAN.md` before touching the eval harness or metrics.

## Non-negotiable rules

- `packages/core` is pure. No DB calls, no network, no `process.env`, no `Date.now()`.
  Functions in, decisions out. Time is always passed in as a parameter.
- The LLM NEVER decides whether an action executes. It classifies failures and drafts
  customer copy. Every money-moving action passes through `packages/core/src/guardrails.ts`.
- Every action writes an `audit_log` row BEFORE it executes, then updates the row with
  the outcome. Never log after the fact only.
- All money is stored and computed as integer paise. Never floats, never rupee decimals.
  Format to rupees only at the UI boundary.
- Razorpay is test mode only. Never write, suggest, or scaffold live-mode keys.
  Key IDs must start with `rzp_test_`.
- Never commit `.env`. Never print a key or secret in logs or console output.
- The held-out eval split is frozen. Never read it, tune against it, or reference it
  outside `scripts/eval`.

## Stack

- npm workspaces (NOT pnpm, NOT yarn). Node 20+.
- `apps/web` — Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui, Recharts
- `apps/worker` — Fastify + BullMQ, long-running process
- `packages/core` — diagnosis, policy, guardrails, types, pure functions only
- `packages/db` — Prisma schema and generated client, Postgres
- Redis via Upstash for BullMQ
- LLM: Gemini Flash via `packages/core/src/llm.ts` behind an `LLMProvider` interface

## Conventions

- No code comments unless the logic is genuinely non-obvious. The code should read plainly.
- Zod schema at every external boundary: webhooks, LLM responses, env vars, API route input.
- Never trust an LLM response shape. Parse it through Zod and handle the failure branch.
- Tests live beside source as `*.test.ts`. `guardrails.ts` and `policy.ts` need real tests
  with real edge cases, not smoke tests.
- Prefer explicit discriminated unions over optional fields for decision types.
- Error handling: fail loud in the worker, fail soft in the UI.

## Commands

```
npm run dev:web       # Next.js dev server
npm run dev:worker    # Fastify + BullMQ worker
npm run db:push       # prisma db push
npm run db:studio     # prisma studio
npm run seed          # generate and load synthetic dataset
npm run eval          # baseline vs agent on held-out split
npm run test          # vitest
```

## Working style

- Show the plan and the file tree before writing anything non-trivial.
- One concern per commit. Commit as soon as something works.
- When a task touches policy or guardrails, propose the rule table first and wait for
  confirmation before implementing.
- If a requirement in a prompt conflicts with this file or `docs/`, say so and stop.
  Do not silently resolve the conflict.
