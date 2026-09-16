import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // docs/mock is design-time reference material rendered by a standalone Node
    // script; it is not application source and is not bundled.
    ignores: ['.next/**', 'node_modules/**', 'lib/kb/*.generated.ts', 'eval-results/**', 'docs/mock/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // CLAUDE.md conventions: no `any`, no non-null assertion.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
]

export default config
