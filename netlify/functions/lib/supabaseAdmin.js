const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabaseAdmin() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }

  client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  return client;
}

module.exports = { getSupabaseAdmin };
