import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabaseConfigured = Boolean(url && key)

const client = supabaseConfigured ? createClient(url, key) : null

if (client) {
  const originalOnAuthStateChange = client.auth.onAuthStateChange.bind(client.auth)
  const filteredOnAuthStateChange: typeof client.auth.onAuthStateChange = (callback) =>
    originalOnAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return
      return callback(event, session)
    })

  client.auth.onAuthStateChange = filteredOnAuthStateChange
}

export const supabase = client
