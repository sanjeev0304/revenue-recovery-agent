import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { llmDiagnosisSchema, type LlmDiagnosis } from '@revenue/core'

export const CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'llm-cache.json')

const cacheFileSchema = z.object({
  model: z.string(),
  entries: z.record(z.string(), llmDiagnosisSchema),
})

export interface LoadedCache {
  map: Map<string, LlmDiagnosis>
  existed: boolean
  entriesOnDisk: number
  modelOnDisk: string | null
}

export function loadLlmCache(model: string, path = CACHE_PATH): LoadedCache {
  if (!existsSync(path)) {
    return { map: new Map(), existed: false, entriesOnDisk: 0, modelOnDisk: null }
  }

  const parsed = cacheFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    throw new Error(
      `${path} exists but does not match the expected shape; delete it to rebuild: ${parsed.error.issues[0]?.message ?? ''}`,
    )
  }

  if (parsed.data.model !== model) {
    throw new Error(
      `${path} was built with model "${parsed.data.model}" but this run uses "${model}". ` +
        'Replaying one model\'s answers under another model\'s name would misattribute the result. ' +
        'Delete the cache to rebuild, or run with the original model.',
    )
  }

  return {
    map: new Map(Object.entries(parsed.data.entries)),
    existed: true,
    entriesOnDisk: Object.keys(parsed.data.entries).length,
    modelOnDisk: parsed.data.model,
  }
}

export function saveLlmCache(
  model: string,
  map: ReadonlyMap<string, LlmDiagnosis>,
  path = CACHE_PATH,
): void {
  const entries: Record<string, LlmDiagnosis> = {}
  for (const key of [...map.keys()].sort()) {
    entries[key] = map.get(key)!
  }
  writeFileSync(path, `${JSON.stringify({ model, entries }, null, 2)}\n`)
}
