// netlify/functions/verifymyth.js
// Node runtime en Netlify. Sin dependencias externas (solo fetch).

const MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const SYSTEM_INSTRUCTION = `
Eres Mito-Bot MMX, un verificador científico directo e informal de España.
Tu misión: desmentir MITOS o confirmar REALIDADES sobre fitness, nutrición y salud.

Reglas duras:
- Devuelve SOLO JSON válido (sin markdown, sin texto extra).
- No uses la palabra "Bulazo". Usa "Mito".
- explanation_simple: 2 frases claras, sin jerga.
- explanation_expert: 3 frases más técnicas, sin ponerse académico.
- evidenceLevel: "Baja" | "Moderada" | "Alta".
- sources: 2 a 6 strings cortas (p. ej. "ISSN Position Stand 2022", "NEJM 2019", "JAMA 2020").
- category: 1-3 palabras.
- relatedMyths: 2 a 5 sugerencias, estilo “mito consultable”.
`.trim();

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    myth: { type: "string" },
    isTrue: { type: "boolean" },
    explanation_simple: { type: "string" },
    explanation_expert: { type: "string" },
    evidenceLevel: { type: "string", enum: ["Baja", "Moderada", "Alta"] },
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

function json(statusCode, obj) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(obj) };
}

function safeStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function safeArr(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function coerceResult(x, fallbackMyth) {
  const evidence = ["Baja", "Moderada", "Alta"].includes(safeStr(x?.evidenceLevel))
    ? safeStr(x.evidenceLevel)
    : "Baja";

  return {
    myth: safeStr(x?.myth) || fallbackMyth || "—",
    isTrue: !!x?.isTrue,
    explanation_simple: safeStr(x?.explanation_simple) || "",
    explanation_expert: safeStr(x?.explanation_expert) || "",
    evidenceLevel: evidence,
    sources: safeArr(x?.sources).slice(0, 8),
    category: safeStr(x?.category) || "General",
    relatedMyths: safeArr(x?.relatedMyths).slice(0, 6),
  };
}

function extractModelText(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return "";
  return parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
}

exports.handler = async (event) => {
  try {
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

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Body inválido (JSON requerido)." });
    }

    const text = safeStr(body?.text);
    if (!text) return json(400, { error: "Texto vacío." });

    // Defensivo: evita inputs muy largos (coste + estabilidad)
    const clipped = text.slice(0, 400);

    const prompt = `Oye, analízame esto: "${clipped}"`;

    const reqBody = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 450,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
      },
    };

    const resp = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(reqBody),
    });

    const geminiJson = await resp.json().catch(() => null);

    if (!resp.ok) {
      return json(resp.status, {
        error: "Error desde Gemini API.",
        details: geminiJson || null,
      });
    }

    const textOut = extractModelText(geminiJson);
    if (!textOut) {
      return json(500, { error: "Respuesta vacía o inválida del modelo.", details: geminiJson || null });
    }

    let parsed;
    try {
      parsed = JSON.parse(textOut);
    } catch {
      // fallback si viniera con ruido (muy raro con schema, pero mejor robusto)
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

    return json(200, coerceResult(parsed, clipped));
  } catch (e) {
    return json(500, { error: "Error interno en Netlify Function.", details: String(e?.message || e) });
  }
};
