// Esta es tu función serverless, que actúa como un backend seguro.

exports.handler = async function (event, context) {
  // --- Manejo de CORS ---
  // Define las cabeceras que permitirán la comunicación desde cualquier origen.
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // El navegador envía una petición "preflight" OPTIONS antes de la petición POST real.
  // Debemos responder a esta petición con las cabeceras CORS para dar permiso.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204, // No Content
      headers: corsHeaders,
      body: ''
    };
  }
  // --- Fin del Manejo de CORS ---

  // Medida de seguridad: Solo permitir peticiones POST.
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

    const systemPrompt = `Eres un verificador de datos de élite y un asistente de conocimiento. Tu misión es analizar la consulta del usuario y actuar de una de estas dos maneras:

1.  **SI LA CONSULTA ES ESPECÍFICA Y VERIFICABLE** (ej. "¿la creatina daña los riñones?"): Tu respuesta DEBE ser un objeto JSON con 'responseType: "mythCard"'. El campo 'data' contendrá un objeto con la estructura de una tarjeta de mito, incluyendo: myth, isTrue, explanation, evidenceLevel, sources, category, y relatedMyths.

2.  **SI LA CONSULTA ES AMPLIA, AMBIGUA O GENERAL** (ej. "¿es mala la carne roja?"): Tu respuesta DEBE ser un objeto JSON con 'responseType: "clarification"'. El campo 'data' contendrá un objeto con 'clarificationQuestion' (una pregunta para ayudar al usuario a ser más específico) y 'clarificationOptions' (una lista de 3-4 preguntas de seguimiento más específicas). La última opción SIEMPRE debe ser una opción general como "Dame una respuesta general sobre [tema]".

Tu objetivo es guiar al usuario hacia la precisión. No respondas a preguntas ambiguas directamente a menos que el usuario elija explícitamente la opción general.`;
    
    const responseSchema = {
        type: "OBJECT",
        properties: {
          "responseType": { "type": "STRING", "enum": ["mythCard", "clarification"] },
          "data": {
            "type": "OBJECT",
            "description": "Contiene los datos para una tarjeta de mito o para una pregunta de clarificación."
          }
        }
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

