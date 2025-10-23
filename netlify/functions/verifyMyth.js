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

    // Modelo estable (puedes sobreescribir con env GEMINI_MODEL)
    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `
Eres un verificador de afirmaciones científicas.

Devuelve JSON con:
- myth: string (afirmación parafraseada si procede)
- isTrue: boolean
- explanation_simple: 2–4 frases, lenguaje cotidiano (nivel B1), sin jerga ni acrónimos;
  usa ejemplo/analogía si ayuda y evita porcentajes innecesarios.
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

    // Schema mínimo compatible (sin additionalProperties ni enum)
    const responseSchema = {
      type: 'object',
      properties: {
        myth: { type: 'string' },
        isTrue: { type: 'boolean' },
        explanation_simple: { type: 'string' },
        explanation_expert: { type: 'string' },
        evidenceLevel: { type: 'string' },
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
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema
      }
      // Nota: no añadimos safetySettings para evitar incompatibilidades de campos.
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

    // ---------- Normalización robusta a JSON puro ----------
    const urlLike = /(https?:\/\/|www\.)[^\s)]+/gi;
    const stripUrls = (s) => typeof s === 'string'
      ? s.replace(urlLike, '').replace(/\(\s*\)/g, '').trim()
      : s;
    const isUrlish = (s) => typeof s === 'string' && /(https?:\/\/|www\.)/i.test(s);

    const stripFences = (t) => {
      let x = (t || '').trim();
      if (x.startsWith('```')) x = x.replace(/^```(?:json)?\s*/i, '').replace(/```$/,'');
      return x.trim();
    };

    const robustParse = (text) => {
      // 1) directo
      try { return JSON.parse(text); } catch {}
      const t = text.trim();

      // 2) array toplevel -> primer objeto
      if (t.startsWith('[')) {
        try {
          const a = JSON.parse(t);
          if (Array.isArray(a) && a.length && typeof a[0] === 'object') return a[0];
        } catch {}
      }

      // 3) extraer bloque { ... } balanceado
      const start = t.indexOf('{');
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < t.length; i++) {
          const ch = t[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
          } else {
            if (ch === '"') inStr = true;
            else if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) {
                const snippet = t.slice(start, i + 1);
                try { return JSON.parse(snippet); } catch {}
                break;
              }
            }
          }
        }
      }
      return null;
    };

    // 1) Si no hay candidatos (bloqueo), creamos fallback
    const pf = result?.promptFeedback;
    if (!result?.candidates?.length) {
      const fallback = {
        myth: userQuery,
        isTrue: false,
        explanation_simple: 'No puedo valorar esta afirmación con seguridad por políticas de la API.',
        explanation_expert: `La API devolvió 0 candidatos. Motivo: ${pf?.blockReason || 'desconocido'}.`,
        evidenceLevel: 'Baja',
        sources: [],
        category: 'Bloqueada',
        relatedMyths: []
      };
      const safeText = JSON.stringify(fallback);
      result.candidates = [{ content: { parts: [{ text: safeText }] } }];
    }

    // 2) Si hay texto, lo normalizamos; si no, fallback
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = robustParse(stripFences(rawText));
    const obj = parsed && typeof parsed === 'object' ? parsed : {
      myth: userQuery,
      isTrue: false,
      explanation_simple: 'No he podido estructurar bien la respuesta. En resumen: no hay pruebas sólidas para afirmarlo con seguridad.',
      explanation_expert: 'Salida no JSON o truncada; respuesta normalizada en servidor.',
      evidenceLevel: 'Baja',
      sources: [],
      category: '',
      relatedMyths: []
    };

    // 3) Saneado anti-URL y tipado
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

    // 4) Reinyecta JSON puro en la respuesta
    const safeText = JSON.stringify(clean);
    if (result?.candidates?.[0]?.content?.parts?.[0]) {
      result.candidates[0].content.parts[0].text = safeText;
    } else {
      result.candidates = [{ content: { parts: [{ text: safeText }] } }];
    }

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'x-mmx-func-version': 'v7-maxsafe-2025-10-23'
      },
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
