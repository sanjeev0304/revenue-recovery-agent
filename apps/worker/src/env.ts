import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RAZORPAY_KEY_ID: z
    .string()
    .startsWith('rzp_test_', 'Live-mode keys are not permitted. Key ID must start with rzp_test_'),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  WARP_ORIGIN: z.coerce.date().optional(),
  WARP_FACTOR: z.coerce.number().positive().finite().optional(),
})
  .superRefine((value, ctx) => {
    const hasOrigin = value.WARP_ORIGIN !== undefined
    const hasFactor = value.WARP_FACTOR !== undefined
    if (hasOrigin === hasFactor) return
    ctx.addIssue({
      code: 'custom',
      path: [hasOrigin ? 'WARP_FACTOR' : 'WARP_ORIGIN'],
      message:
        'WARP_ORIGIN and WARP_FACTOR must be set together. A warped run must declare both, so the simulated timeline is an explicit input rather than something captured at boot.',
    })
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  throw new Error(`Invalid environment:\n${issues}`)
}

export const env = parsed.data
