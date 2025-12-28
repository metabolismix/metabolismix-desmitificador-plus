// netlify/functions/verifymyth.js
// FINAL — ESM para Netlify (export const handler)
// Gemini 2.5 Flash + JSON schema + maxOutputTokens 450
// Sin dependencias externas (solo fetch)

const MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(statusCode, obj) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(obj) };
}

function safeString(x, maxLen) {
  return (x ?? "").toString().trim().slice(0, maxLen);
}

function normalizeEvidenceLevel(x) {
  const v = (x ?? "").toString().trim().toLowerCase();
  if (v === "alta") return "Alta";
  if (v === "moderada") return "Moderada";
  return "Baja";
}

function ensureArrayOfStrings(x, maxItems, maxLenEach) {
  if (!Array.isArray(x)) return [];
  return x
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLenEach));
}

function extractModelText(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return "";
  return parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
}

export const handler = async (event) => {
  try {
    // Healthcheck: abre /.netlify/functions/verifymyth en el navegador y debe salir 200 JSON
    if (event.httpMethod === "GET") {
      return json(200, { ok: true, message: "verifymyth function alive" });
    }

    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json(500, { error: "Falta GEMINI_API_KEY en variables de entorno de Netlify." });
    }

    let raw;
    try {
      raw = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Body inválido (JSON requerido)." });
    }

    const userText = safeString(raw?.text, 420);
    if (!userText) return json(400, { error: "Falta el campo text." });

    const systemInstruction = `
Eres Mito-Bot MMX, un verificador científico directo e informal de España sobre fitness, nutrición y salud.
Tu misión: confirmar REALIDADES o desmentir MITOS.

Reglas duras:
- Devuelve SOLO JSON válido (sin markdown, sin texto extra).
- No uses la palabra "Bulazo". Usa siempre "Mito".
- explanation_simple: 2 frases claras, sin jerga.
- explanation_expert: 3 frases más técnicas (mecanismo/condiciones/limitaciones), sin ponerse académico.
- evidenceLevel: "Baja" | "Moderada" | "Alta".
- sources: 0-6 strings cortas (ej: "ISSN Position Stand", "NEJM", "JAMA", "Cochrane").
- category: 1-3 palabras.
- relatedMyths: 0-5 sugerencias cortas.
`.trim();

    const prompt =
      `Analiza esta afirmación y da un veredicto.\n` +
      `Afirmación: "${userText}"\n\n` +
      `INSTRUCCIONES:\n` +
      `- Devuelve SOLO JSON válido.\n`;

    // Nota: en esta API v1beta, se usa responseSchema (no responseJsonSchema) para forzar JSON. (Funciona bien en Netlify)
    const responseSchema = {
      type: "object",
      properties: {
        myth: { type: "string" },
        isTrue: { type: "boolean" },
        explanation_simple: { type: "string" },
        explanation_expert: { type: "string" },
        evidenceLevel: { type: "string" },
        sources: { type: "array", items: { type: "string" } },
        category: { type: "string" },
        relatedMyths: { type: "array", items: { type: "string" } },
      },
      required: [
        "myth",
        "isTrue",
        "explanation_simple",
        "explanation_expert",
        "evidenceLevel",
        "sources",
        "category",
        "relatedMyths",
      ],
    };

    const reqBody = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens: 450,
        temperature: 0.4,
      },
    };

    // ✅ Forma más robusta en Functions: key en querystring (evita cabeceras raras en edge/proxy)
    const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    const geminiJson = await resp.json().catch(() => null);

    if (!resp.ok) {
      return json(resp.status, { error: "Error desde Gemini API.", details: geminiJson });
    }

    const textOut = extractModelText(geminiJson);
    if (!textOut) {
      return json(500, { error: "Respuesta vacía o inválida del modelo.", details: geminiJson });
    }

    let parsed;
    try {
      parsed = JSON.parse(textOut);
    } catch {
      // fallback si viniera con algo raro
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(textOut.slice(start, end + 1));
        } catch {
          return json(500, { error: "El modelo no devolvió JSON parseable.", raw: textOut });
        }
      } else {
        return json(500, { error: "El modelo no devolvió JSON parseable.", raw: textOut });
      }
    }

    const clean = {
      myth: safeString(parsed?.myth, 220) || userText,
      isTrue: Boolean(parsed?.isTrue),
      explanation_simple: safeString(parsed?.explanation_simple, 420),
      explanation_expert: safeString(parsed?.explanation_expert, 700),
      evidenceLevel: normalizeEvidenceLevel(parsed?.evidenceLevel),
      sources: ensureArrayOfStrings(parsed?.sources, 6, 70),
      category: safeString(parsed?.category, 40) || "General",
      relatedMyths: ensureArrayOfStrings(parsed?.relatedMyths, 5, 120),
    };

    const usage = geminiJson?.usageMetadata || null;

    return json(200, { result: clean, usage });
  } catch (e) {
    return json(500, { error: "Error interno en Netlify Function.", details: String(e?.message || e) });
  }
};
