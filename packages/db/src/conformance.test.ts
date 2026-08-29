import { describe, expect, it } from 'vitest'
import {
  ActionStatus,
  ActionType,
  AuditEvent,
  ClassifierKind,
  EvalArm,
  EvalSplit,
  PaymentMethod,
  PaymentStatus,
  RootCause,
} from '@prisma/client'
import {
  actionStatusSchema,
  actionTypeSchema,
  auditEventSchema,
  classifierKindSchema,
  evalArmSchema,
  evalSplitSchema,
  paymentMethodSchema,
  paymentStatusSchema,
  rootCauseSchema,
} from '@revenue/core'

const pairs = [
  ['RootCause', RootCause, rootCauseSchema.options],
  ['PaymentMethod', PaymentMethod, paymentMethodSchema.options],
  ['PaymentStatus', PaymentStatus, paymentStatusSchema.options],
  ['ClassifierKind', ClassifierKind, classifierKindSchema.options],
  ['ActionType', ActionType, actionTypeSchema.options],
  ['ActionStatus', ActionStatus, actionStatusSchema.options],
  ['AuditEvent', AuditEvent, auditEventSchema.options],
  ['EvalSplit', EvalSplit, evalSplitSchema.options],
  ['EvalArm', EvalArm, evalArmSchema.options],
] as const

describe('core enums mirror the prisma schema', () => {
  it.each(pairs)('%s', (_name, prismaEnum, coreOptions) => {
    expect([...coreOptions].sort()).toEqual(Object.values(prismaEnum).sort())
  })
})
