import { loadConfig } from './storage.js';

export async function invokeModel(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string | null> {
  const config = await loadConfig();
  const endpoint = `${config.models.default.baseUrl.replace(/\/$/, '')}/chat/completions`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.models.default.model,
        messages,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content.map((item) => item.text || '').join('').trim() || null;
    }

    return null;
  } catch {
    return null;
  }
}
