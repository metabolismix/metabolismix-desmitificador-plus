// Esta es tu función serverless, que actúa como un backend seguro.

exports.handler = async function (event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
        statusCode: 405, 
        headers: corsHeaders, 
        body: 'Method Not Allowed' 
    };
  }

  try {
    const { userQuery } = JSON.parse(event.body);

    if (!userQuery) {
      return { 
          statusCode: 400, 
          headers: {...corsHeaders, 'Content-Type': 'application/json'}, 
          body: JSON.stringify({ error: 'userQuery is required' }) 
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error("La clave API de Gemini no está configurada en el servidor.");
    }
    
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = `Eres un verificador de datos de élite con acceso a la información científica más reciente. Tu única misión es analizar la consulta del usuario y devolver SIEMPRE un único objeto JSON con la estructura de una "tarjeta de mito". No intentes clarificar preguntas, da siempre la mejor respuesta posible basada en la consulta. La rigurosidad y el formato estricto son críticos.
1.  **Analiza la afirmación:** Evalúa si el mito es verdadero o falso.
2.  **Proporciona DOS explicaciones:** Es CRÍTICO que generes ambas.
    - **explanation_simple:** Resumen en lenguaje CLARO Y SENCILLO, sin tecnicismos.
    - **explanation_expert:** Explicación técnica y profesional para expertos.
3.  **Clasifica la evidencia:** Determina el nivel de evidencia ('Alta', 'Moderada', 'Baja').
4.  **Cita las fuentes:** Proporciona una lista de 2-3 tipos de fuentes GENÉRICAS y autoritativas. IMPORTANTE: NO uses citas académicas completas con autores, años o títulos de revistas. USA SOLO categorías como "Metaanálisis", "Revisiones sistemáticas (Cochrane)", "Ensayos Clínicos Aleatorizados (RCTs)", "Guías de Práctica Clínica".
5.  **Categoriza el mito:** Asigna una única y concisa categoría (ej. 'Nutrición', 'Suplementos').
6.  **Sugiere mitos relacionados:** Proporciona una lista de 2 o 3 mitos relacionados.`;
    
    const responseSchema = {
        type: "OBJECT",
        properties: {
            "myth": { "type": "STRING" },
            "isTrue": { "type": "BOOLEAN" },
            "explanation_simple": { "type": "STRING" },
            "explanation_expert": { "type": "STRING" },
            "evidenceLevel": { "type": "STRING", "enum": ["Alta", "Moderada", "Baja"] },
            "sources": { "type": "ARRAY", "items": { "type": "STRING" } },
            "category": { "type": "STRING" },
            "relatedMyths": { "type": "ARRAY", "items": { "type": "STRING" } }
        },
        required: ["myth", "isTrue", "explanation_simple", "explanation_expert", "evidenceLevel", "sources", "category", "relatedMyths"]
    };

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Google API Error:', errorBody);
      return { 
          statusCode: response.status, 
          headers: {...corsHeaders, 'Content-Type': 'application/json'},
          body: JSON.stringify({ error: `Google API Error: ${errorBody}` }) 
      };
    }

    const result = await response.json();

    return {
      statusCode: 200,
      headers: {...corsHeaders, 'Content-Type': 'application/json'},
      body: JSON.stringify(result),
    };

  } catch (error) {
    console.error('Serverless function error:', error.message);
    return {
      statusCode: 500,
      headers: {...corsHeaders, 'Content-Type': 'application/json'},
      body: JSON.stringify({ error: error.message }),
    };
  }
};

