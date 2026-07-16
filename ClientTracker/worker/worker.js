// worker.js — Cloudflare Worker
//
// Single job: receive a prompt from the Client Tracker app, call the
// Anthropic API using a secret key that lives only on Cloudflare (never in
// browser code), and hand back the AI's text response.
//
// Deployed at some URL like: https://clienttrack-ai.<your-subdomain>.workers.dev

const ALLOWED_ORIGIN = '*'; // tighten to your Pages URL once deployed, e.g. 'https://clienttrack.pages.dev'
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const prompt = body && body.prompt;
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "prompt" string in body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server missing ANTHROPIC_API_KEY secret' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await anthropicRes.json();

      if (!anthropicRes.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || 'Anthropic API error' }), {
          status: anthropicRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }

      const textBlock = (data.content || []).find((c) => c.type === 'text');
      return new Response(JSON.stringify({ text: textBlock ? textBlock.text : '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Worker error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
  },
};
