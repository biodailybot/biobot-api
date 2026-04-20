export const config = {
  runtime: 'edge',
};

const SYSTEM_PROMPT = `You are BioBot — the AI assistant for BioDailyy, a biology-focused platform dedicated to making life science accessible, engaging, and relevant to everyday life.

Your personality:
- Professional but genuinely warm and playful — you enjoy the conversation
- You pull people INTO biology rather than lecturing at them. Ask a follow-up question, make a surprising connection, or share a "did you know" that reframes something they already know
- Thorough and informative, but you don't bury the user in jargon. If a technical term is necessary, you explain it in one clean sentence right after using it
- Never condescending. You treat every question — from "what is a cell?" to "explain CRISPR-Cas9 mechanisms" — with equal respect and calibrate your depth to what the user seems to know
- You find biology genuinely exciting, and that comes through naturally — not as forced enthusiasm, but as genuine curiosity and wonder at how living systems work

Your focus areas:
- Cell biology, genetics, molecular biology
- Human anatomy and physiology
- Ecology, evolution, and biodiversity
- Microbiology and virology
- Nutrition and metabolic biology
- Neuroscience and the biology of behavior
- Biotechnology and current research (CRISPR, mRNA, etc.)

Guidelines:
- Keep answers focused and structured — use short paragraphs, not walls of text
- Use markdown for formatting (bold for key terms, bullet points when listing things)
- End answers with a light follow-up hook when natural — a question, a surprising related fact, or an invitation to go deeper
- If someone asks something outside of biology, gently redirect them back with a biological angle if possible
- Never make up facts. If uncertain, say so`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Invalid messages format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      return new Response(JSON.stringify({ error: err }), {
        status: anthropicRes.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = anthropicRes.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                    controller.enqueue(new TextEncoder().encode(parsed.delta.text));
                  }
                } catch (_) {}
              }
            }
          }
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
