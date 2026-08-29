import type { FastifyInstance } from 'fastify'
import type { IngestRepo } from './repo.js'
import { processWebhookEvent } from './processEvent.js'
import { EVENT_ID_HEADER, SIGNATURE_HEADER, eventIdFor, verifyWebhookSignature } from './signature.js'

export interface WebhookRouteOptions {
  repo: IngestRepo
  secret: string
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  options: WebhookRouteOptions,
): Promise<void> {
  app.post(
    '/webhooks/razorpay',
    {
      config: { rawBody: true },
      bodyLimit: 1_048_576,
    },
    async (request, reply) => {
      const rawBody = request.body

      if (!Buffer.isBuffer(rawBody)) {
        request.log.error('raw body parser did not run for the webhook route')
        return reply.code(500).send({ error: 'raw_body_unavailable' })
      }

      const verdict = verifyWebhookSignature(
        rawBody,
        request.headers[SIGNATURE_HEADER],
        options.secret,
      )

      if (!verdict.ok) {
        request.log.warn({ reason: verdict.reason }, 'rejected webhook signature')
        return reply.code(401).send({ error: verdict.reason })
      }

      const eventId = eventIdFor(request.headers[EVENT_ID_HEADER], rawBody)

      let result
      try {
        result = await processWebhookEvent(options.repo, {
          eventId,
          rawBody,
          signatureVerified: true,
          receivedAt: new Date(),
        })
      } catch (err) {
        request.log.error({ err, eventId }, 'failed to persist webhook event')
        return reply.code(500).send({ error: 'persistence_failed' })
      }

      request.log.info({ eventId, status: result.status }, 'webhook handled')
      return reply.code(result.httpStatus).send({ status: result.status })
    },
  )
}

export function registerRawBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      if (request.routeOptions.config?.rawBody === true) {
        done(null, body)
        return
      }
      try {
        const text = (body as Buffer).toString('utf8')
        done(null, text.length === 0 ? null : JSON.parse(text))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )
}
