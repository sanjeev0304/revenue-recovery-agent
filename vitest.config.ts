import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{apps,packages,scripts}/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
})
