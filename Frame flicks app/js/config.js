// config.js — the only file you need to edit after deploying your backend.
// Fill these in once you've created the Supabase project and Worker
// (see SETUP.md for exact steps).

export const SUPABASE_URL = 'https://vkuvdmqtlkrlanrzkfdz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdXZkbXF0bGtybGFucnprZmR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxODc0NzMsImV4cCI6MjA5OTc2MzQ3M30.8jXiFrY-C4V5CpnLQpf_PHMr_YwsOS2CZrJWcd-RLx0';


// Web Push (calendar notifications). Paste the PUBLIC key from
// `npx web-push generate-vapid-keys` here — see SETUP.md, "Push notifications".
// (The private key never goes in this file; it's a Supabase secret.)
export const VAPID_PUBLIC_KEY = '';
