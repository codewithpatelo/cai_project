import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The OpenRouter and Supabase keys are read inside route handlers only. Nothing
  // here may expose an env var to the client bundle -- no `env` block, on purpose.
}

export default nextConfig
