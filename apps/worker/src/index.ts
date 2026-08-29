import { env } from './env.js'
import { buildServer } from './server.js'
import { PrismaIngestRepo } from './ingest/prismaRepo.js'

const app = await buildServer({
  repo: new PrismaIngestRepo(),
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  logLevel: env.NODE_ENV === 'production' ? 'info' : 'debug',
})

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
