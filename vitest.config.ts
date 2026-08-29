import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{apps,packages,scripts}/*/src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
})
