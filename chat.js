// BioBot API — Vercel serverless function
// Proxies chat requests from biobot-embed.html to the Anthropic Messages API.
//
// File location in the repo: api/chat.js  ->  served at /api/chat
// Required Vercel environment variable: ANTHROPIC_API_KEY

const MODEL       = 'claude-haiku-4-5-20251001'; // swap to 'claude-sonnet-4-6' for higher-quality (pricier) answers
const MAX_TOKENS  = 1200;
const MAX_HISTORY = 20;    // most recent turns forwarded to the model
const MAX_CHARS   = 6000;  // per-message character cap

const SYSTEM_PROMPT = [
  'You are BioBot, the AI biology assistant for BioDaily (biodaily.org), a publication',
  'that explains biology breakthroughs in clear, accessible language.',
  'Help people understand biology: genetics, cell biology, neuroscience, microbiology,',
  'immunology, ecology, biotechnology, and the science behind medicine.',
  'Explain concepts the way a strong science writer would — accurate, concrete, and free of',
  'unnecessary jargon. Use short paragraphs, and Markdown (lists, bold, headings) when it aids clarity.',
  'If a question falls outside biology, briefly say so and steer back to biology.',
  'Do not give personalized medical, diagnostic, or treatment advice — explain the underlying',
  'science and suggest consulting a qualified professional for personal health concerns.',
  'Keep answers focused and reasonably concise.'
].join(' ');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    const incoming = body && Array.isArray(body.messages) ? body.messages : null;
    if (!incoming || !incoming.length) {
      res.status(400).json({ error: 'Request must include a non-empty "messages" array.' });
      return;
    }

    const messages = incoming
      .filter(m =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim()
      )
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (!messages.length) {
      res.status(400).json({ error: 'No valid messages provided.' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Server is missing its API key. Set ANTHROPIC_API_KEY in Vercel.' });
      return;
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const detail = data && data.error && data.error.message
        ? data.error.message
        : 'The AI service returned an error.';
      res.status(502).json({ error: detail });
      return;
    }

    const reply = ((data && data.content) || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    res.status(200).json({
      reply: reply || 'I was not able to generate a response. Please try rephrasing your question.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong handling the request.' });
  }
}
