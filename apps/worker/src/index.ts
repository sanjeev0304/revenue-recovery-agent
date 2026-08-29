import { env } from './env.js'
import { buildServer } from './server.js'
import { createClock } from './clock.js'
import { PrismaIngestRepo } from './ingest/prismaRepo.js'

const clock = createClock({
  warpOrigin: env.WARP_ORIGIN ?? null,
  warpFactor: env.WARP_FACTOR ?? null,
})

const app = await buildServer({
  repo: new PrismaIngestRepo(),
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  logLevel: env.NODE_ENV === 'production' ? 'info' : 'debug',
  clock,
})

app.log.info(
  {
    clock: clock.kind,
    warpOrigin: env.WARP_ORIGIN?.toISOString() ?? null,
    warpFactor: env.WARP_FACTOR ?? null,
    simulatedNow: clock.now().toISOString(),
  },
  `clock: ${clock.describe()}`,
)

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
