// Tests never touch the network and never read a real key. Anything that
// tries to reach OpenRouter or Supabase in a unit test is a bug in the test,
// so the env is blanked rather than populated with a plausible-looking fake.
process.env.OPENROUTER_API_KEY = ''
process.env.SUPABASE_URL = ''
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
process.env.OPENROUTER_KEY_PROFILE = 'dev'
