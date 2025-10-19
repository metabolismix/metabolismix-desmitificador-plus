// netlify/functions/verifyMyth.js
exports.handler = async function (event, context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  try {
    const { userQuery } = JSON.parse(event.body || '{}');
    if (!userQuery || typeof userQuery !== 'string') {
      return {
        statusCode: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetro "userQuery" requerido.' })
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return {
        statusCode: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Falta GEMINI_API_KEY en variables de entorno.' })
      };
    }

    // Modelo estable (evita previas deprecadas)
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres un verificador de afirmaciones científicas. Devuelve JSON estricto con:
- myth: afirmación del usuario (parafraseada si procede)
- isTrue: boolean
- explanation_simple: explicación breve y clara para público general
- explanation_expert: explicación rigurosa con matices metodológicos
- evidenceLevel: "Alta" | "Moderada" | "Baja"
- sources: lista de URLs o referencias (máx. 5)
- category: etiqueta breve (p.ej., "Nutrición", "Ejercicio", "Sueño"...)
- relatedMyths: lista de 0..5 afirmaciones relacionadas
No des recomendaciones clínicas personalizadas.
`;

    // ⬇️ Sin "additionalProperties"
    const responseSchema = {
      type: 'object',
      properties: {
        myth: { type: 'string' },
        isTrue: { type: 'boolean' },
        explanation_simple: { type: 'string' },
        explanation_expert: { type: 'string' },
        evidenceLevel: { type: 'string', enum: ['Alta', 'Moderada', 'Baja'] },
        sources: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        relatedMyths: { type: 'array', items: { type: 'string' } }
      },
      required: ['myth','isTrue','explanation_simple','explanation_expert','evidenceLevel']
      // Si vieras otro 400 por "enum", comenta la línea de enum de evidenceLevel.
    };

    const payload = {
      contents: [{ role: 'user', parts: [{ text: userQuery }] }],
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = result?.error?.message || JSON.stringify(result);
      return {
        statusCode: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Google API Error: ${msg}` })
      };
    }

    // Devolvemos RAW para que el frontend siga leyendo candidates[0].content.parts[0].text
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Internal Server Error: ${error?.message || String(error)}` })
    };
  }
};
