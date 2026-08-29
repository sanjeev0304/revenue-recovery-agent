import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

const sourceFiles = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(SRC, f), 'utf8')] as const)

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['Date.now()', /\bDate\.now\s*\(/],
  ['argless new Date()', /new Date\s*\(\s*\)/],
  ['process.env', /\bprocess\.env\b/],
  ['fetch', /\bfetch\s*\(/],
  ['Math.random', /\bMath\.random\s*\(/],
  ['prisma import', /from\s+['"]@prisma\/client['"]/],
  ['db import', /from\s+['"]@revenue\/db['"]/],
  ['node builtin import', /from\s+['"]node:/],
]

describe('packages/core is pure', () => {
  it('has source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(5)
  })

  it.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    const offenders = sourceFiles
      .filter(([, body]) => pattern.test(body))
      .map(([name]) => name)
    expect(offenders).toEqual([])
  })

  it('declares only zod as a runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod'])
  })
})
