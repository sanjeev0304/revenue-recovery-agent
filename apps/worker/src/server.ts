import Fastify, { type FastifyInstance } from 'fastify'
import type { IngestRepo } from './ingest/repo.js'
import { registerRawBodyParser, registerWebhookRoutes } from './ingest/route.js'

export interface BuildServerOptions {
  repo: IngestRepo
  webhookSecret: string
  logLevel?: string
}

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: [
        'req.headers.authorization',
        'req.headers["x-razorpay-signature"]',
        'req.headers["X-Razorpay-Signature"]',
      ],
    },
  })

  registerRawBodyParser(app)

  app.get('/health', async () => ({ status: 'ok' }))

  await registerWebhookRoutes(app, { repo: options.repo, secret: options.webhookSecret })

  return app
}
