const TRANSIENT_CODES = new Set(['P1017', 'P2024', 'P2028', 'P1001', 'P1002'])

function isTransient(err: unknown): boolean {
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && TRANSIENT_CODES.has(code)
}

export async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransient(err)) throw err
      lastError = err
      if (attempt === attempts) break
      const backoffMs = 250 * 2 ** (attempt - 1)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  throw new Error(
    `${label} failed after ${attempts} attempts: ${(lastError as Error).message.slice(0, 200)}`,
  )
}
