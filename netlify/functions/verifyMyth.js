// netlify/functions/verifymyth.js
// Node 18+ (Netlify Functions). Sin dependencias externas.

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_INSTRUCTION = `
Eres Mito-Bot MMX, un verificador científico directo e informal de España.
Tu misión: desmentir MITOS (carmín) o confirmar REALIDADES (esmeralda) sobre fitness, nutrición y salud.

Reglas:
- Devuelve SOLO JSON (sin markdown, sin texto extra).
- No uses la palabra "Bulazo". Usa "Mito".
- explanation_simple: 2 frases claras, sin jerga.
- explanation_expert: 3 frases más técnicas, pero sin ponerse académico.
- evidenceLevel: "Baja" | "Moderada" | "Alta".
- sources: 2 a 6 strings cortas (p. ej. "ISSN Position Stand 2022", "NEJM 2019", "ESC 2023").
- category: 1-3 palabras (p. ej. "Suplementos", "Entrenamiento", "Nutrición", "Sueño", "Cardiometabólico").
- relatedMyths: 2 a 5 sugerencias, estilo “mito consultable”.
`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    myth: { type: "string" },
    isTrue: { type: "boolean" },
    explanation_simple: { type: "string" },
    explanation_expert: { type: "string" },
    evidenceLevel: { type: "string", enum: ["Baja", "Moderada", "Alta"] },
    sources: { type: "array", items: { type: "string" } },
    category: { type: "string" },
    relatedMyths: { type: "array", items: { type: "string" } }
  },
  required: [
    "myth",
    "isTrue",
    "explanation_simple",
    "explanation_expert",
    "evidenceLevel",
    "sources",
    "category",
    "relatedMyths"
  ]
};

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS"
    },
    body: JSON.stringify(bodyObj)
  };
}

function coerceResult(x) {
  const safe = (v) => (typeof v === "string" ? v.trim() : "");
  const safeArr = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean) : []);

  let evidence = safe(x.evidenceLevel);
  if (!["Baja", "Moderada", "Alta"].includes(evidence)) evidence = "Baja";

  return {
    myth: safe(x.myth) || "—",
    isTrue: !!x.isTrue,
    explanation_simple: safe(x.explanation_simple) || "No he podido generar una explicación simple.",
    explanation_expert: safe(x.explanation_expert) || "No he podido generar una explicación experta.",
    evidenceLevel: evidence,
    sources: safeArr(x.sources).slice(0, 8),
    category: safe(x.category) || "General",
    relatedMyths: safeArr(x.relatedMyths).slice(0, 6)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Método no permitido" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonResponse(500, { error: "Falta GEMINI_API_KEY en variables de entorno" });

  let text = "";
  try {
    const body = JSON.parse(event.body || "{}");
    text = String(body.text || "");
  } catch {
    return jsonResponse(400, { error: "Body inválido (JSON requerido)" });
  }

  const cleaned = text.trim();
  if (!cleaned) return jsonResponse(400, { error: "Texto vacío" });
  if (cleaned.length > 240) return jsonResponse(400, { error: "Texto demasiado largo (máx 240 caracteres)" });

  const userPrompt = `Oye, analízame esto: "${cleaned}"`;

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    },
    contents: [{
      role: "user",
      parts: [{ text: userPrompt }]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 420,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA
    }
  };

  try {
    const resp = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return jsonResponse(502, { error: `Gemini API error (${resp.status})`, details: t.slice(0, 500) });
    }

    const data = await resp.json();

    const textOut =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(textOut);
    } catch {
      // Por si viniera con ruido (raro en structured outputs, pero mejor blindar)
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      if (start >= 0 && end > start) {
        parsed = JSON.parse(textOut.slice(start, end + 1));
      } else {
        return jsonResponse(502, { error: "No se pudo parsear JSON de Gemini", details: textOut.slice(0, 500) });
      }
    }

    return jsonResponse(200, coerceResult(parsed));
  } catch (e) {
    return jsonResponse(500, { error: "Fallo llamando a Gemini", details: String(e?.message || e) });
  }
};
