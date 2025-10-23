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

    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres un verificador de afirmaciones científicas.

Devuelve JSON con:
- myth: string (afirmación parafraseada si procede)
- isTrue: boolean
- explanation_simple: 2–4 frases, lenguaje cotidiano (nivel B1), sin jerga ni acrónimos,
  sin porcentajes salvo que sean imprescindibles; usa ejemplo/analogía si ayuda.
- explanation_expert: versión técnica y matizada (calidad y diseño de estudios)
- evidenceLevel: "Alta" | "Moderada" | "Baja"
- sources: array<string> con TIPOS DE EVIDENCIA (p. ej., "Revisiones sistemáticas",
  "Ensayos clínicos aleatorizados", "Cohortes observacionales", "Opinión de expertos").
  NO incluyas URLs, DOIs ni identificadores. SOLO tipos.
- category: etiqueta breve (Nutrición, Ejercicio, Sueño, etc.)
- relatedMyths: 0..5 afirmaciones relacionadas (sin URLs).

Criterios del nivel de evidencia:
- Alta: metaanálisis/revisiones sistemáticas consistentes o múltiples ECA grandes.
- Moderada: algunos ECA pequeños o consistencia observacional.
- Baja: evidencia limitada/contradictoria o basada en mecanismos/series pequeñas.

Nunca des recomendaciones clínicas personalizadas.
NO incluyas URLs ni DOIs en ningún campo.
`;

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

    // --- SANEADO ANTI-URL Y FORZADO JSON LIMPIO ---
    const urlLike = /(https?:\/\/|www\.)[^\s)]+/gi;
    const stripUrls = (s) => typeof s === 'string' ? s.replace(urlLike, '').replace(/\(\s*\)/g,'').trim() : s;
    const isUrlish = (s) => typeof s === 'string' && /(https?:\/\/|www\.)/i.test(s);

    try {
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const obj = JSON.parse(text);

      const clean = {
        myth: stripUrls(obj.myth || userQuery),
        isTrue: !!obj.isTrue,
        explanation_simple: stripUrls(obj.explanation_simple || ''),
        explanation_expert: stripUrls(obj.explanation_expert || ''),
        evidenceLevel: stripUrls(obj.evidenceLevel || 'Baja'),
        sources: Array.isArray(obj.sources) ? obj.sources.filter(s => !isUrlish(s)).map(stripUrls) : [],
        category: stripUrls(obj.category || ''),
        relatedMyths: Array.isArray(obj.relatedMyths) ? obj.relatedMyths.filter(s => !isUrlish(s)).map(stripUrls) : []
      };

      const safeText = JSON.stringify(clean); // <- JSON puro y válido
      if (result?.candidates?.[0]?.content?.parts?.[0]) {
        result.candidates[0].content.parts[0].text = safeText;
      }
    } catch {
      // Si por algún motivo no se puede parsear, dejamos el RAW (el frontend tiene parseo robusto)
    }
    // ---------------------------------------------

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
