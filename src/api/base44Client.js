import { createClient } from '@staticbot/base44-supabase-shim';

export const base44 = createClient({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  schemaPrefix: 'public',
  integrations: {
    invokeLlmFunction: 'staticbot-llm-relay',
    extractDataFunction: 'staticbot-llm-relay',
    generateImageFunction: 'staticbot-image-relay',
    defaultBucket: 'public_base44_assets',
    privateBucket: 'public_base44_assets_private',
    signFileFunction: 'staticbot-file-signer',
  },
});
