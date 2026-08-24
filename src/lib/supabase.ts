import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabaseConfigured = Boolean(url && key)

const client = supabaseConfigured ? createClient(url, key) : null

if (client) {
  const originalOnAuthStateChange = client.auth.onAuthStateChange.bind(client.auth)
  const filteredOnAuthStateChange: typeof client.auth.onAuthStateChange = (callback) => {
    let lastUserId: string | null = null

    return originalOnAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null

      if (event === 'TOKEN_REFRESHED') {
        lastUserId = nextUserId ?? lastUserId
        return
      }

      if (event === 'INITIAL_SESSION') {
        lastUserId = nextUserId
        return callback(event, session)
      }

      if (event === 'SIGNED_IN') {
        if (nextUserId && nextUserId === lastUserId) return
        lastUserId = nextUserId
        return callback(event, session)
      }

      if (event === 'SIGNED_OUT') {
        lastUserId = null
        return callback(event, session)
      }

      if (nextUserId) lastUserId = nextUserId
      return callback(event, session)
    })
  }

  client.auth.onAuthStateChange = filteredOnAuthStateChange
}

export const supabase = client
