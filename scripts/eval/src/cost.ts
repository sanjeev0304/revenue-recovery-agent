export const COST_PER_CHARGE_ATTEMPT_PAISE = 300

export const COST_PER_MESSAGE_PAISE = 25

export const COST_ASSUMPTIONS = [
  `charge attempt: ${COST_PER_CHARGE_ATTEMPT_PAISE} paise (₹3.00) per gateway attempt, successful or not`,
  `customer message: ${COST_PER_MESSAGE_PAISE} paise (₹0.25) per nudge delivered`,
  'payment links are free to mint and are not charged',
  'escalations are not costed: a human queue has a real cost but not one this dataset can support a number for',
] as const

export function operationalCostPaise(chargeAttempts: number, contacts: number): number {
  return (
    chargeAttempts * COST_PER_CHARGE_ATTEMPT_PAISE + contacts * COST_PER_MESSAGE_PAISE
  )
}
