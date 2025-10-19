// netlify/functions/verifyMyth.js

const ALLOWED_ORIGIN = '*'; // ajusta a tu dominio si quieres restringir

const headers = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const respond = (statusCode, bodyObj) => ({
  statusCode,
  headers,
  body: JSON.stringify(bodyObj),
});

exports.handler = async (event, context) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { userQuery } = JSON.parse(event.body || '{}');
    if (!userQuery || typeof userQuery !== 'string') {
      return respond(400, { error: 'Parámetro "userQuery" requerido.' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return respond(500, { error: 'Falta GEMINI_API_KEY en variables de entorno.' });
    }

    const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemInstruction = `
Eres un verificador de afirmaciones científicas. Devuelves JSON estricto con:
- claim: afirmación del usuario, parafraseada si es necesario
- verdict: "Verdadero" | "Parcial" | "Falso" | "No concluyente"
- evidence_level: "Alta" | "Moderada" | "Baja"
- summary: explicación breve, objetiva, citando el tipo de evidencia
- citations: lista de URLs relevantes (máx. 5), si existen públicos

Normas:
- No prometas asesoramiento médico.
- Si la evidencia es limitada o conflictiva, marca "No concluyente".
- En "citations", prioriza fuentes revisadas por pares o guías.
`;

    const responseSchema = {
      type: 'object',
      properties: {
        claim: { type: 'string' },
        verdict: { type: 'string', enum: ['Verdadero', 'Parcial', 'Falso', 'No concluyente'] },
        evidence_level: { type: 'string', enum: ['Alta', 'Moderada', 'Baja'] },
        summary: { type: 'string' },
        citations: { type: 'array', items: { type: 'string' } }
      },
      required: ['verdict', 'summary'],
      additionalProperties: true
    };

    const payload = {
      systemInstruction: { role: 'user', parts: [{ text: systemInstruction }] },
      contents: [
        { role: 'user', parts: [{ text: userQuery }] }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema
      }
    };

    const apiRes = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const raw = await apiRes.json().catch(() => ({}));

    if (!apiRes.ok) {
      const msg = raw?.error?.message || JSON.stringify(raw);
      return respond(apiRes.status, { error: `Google API Error: ${msg}` });
    }

    // Extrae el JSON del primer candidato
    const part = raw?.candidates?.[0]?.content?.parts?.[0];
    let data = {};
    if (part?.text) {
      try { data = JSON.parse(part.text); } catch { data = { summary: part.text } }
    } else if (typeof part === 'object' && part !== null) {
      // En casos raros puede venir ya como objeto
      data = part;
    }

    // Normalización mínima de campos
    if (data && typeof data === 'object') {
      if (data.evidenceLevel && !data.evidence_level) {
        data.evidence_level = data.evidenceLevel;
      }
      if (!Array.isArray(data.citations)) data.citations = [];
      if (!data.claim) data.claim = userQuery;
    }

    return respond(200, { ok: true, data });
  } catch (err) {
    return respond(500, { error: `Server error: ${err?.message || String(err)}` });
  }
};
