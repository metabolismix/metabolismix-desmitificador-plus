const { GoogleGenerativeAI } = require('@google/genai');

// Configuración de CORS para Netlify
const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Configuración de la API Key (asegúrese de que esté en las variables de entorno de Netlify)
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("GEMINI_API_KEY no está configurada.");
}
const ai = new GoogleGenerativeAI(API_KEY);
const model = 'gemini-2.5-flash';

// Definición del esquema JSON (Data Schema) para guiar la respuesta de la IA
const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        myth: {
            type: 'STRING',
            description: 'La afirmación o mito que se está verificando. Limite a una sola frase descriptiva sin explicación.'
        },
        isTrue: {
            type: 'BOOLEAN',
            description: 'Verdadero si la afirmación es científicamente válida o ampliamente aceptada; Falso si es incorrecta o engañosa.'
        },
        explanation_simple: {
            type: 'STRING',
            description: 'Una explicación clara y concisa (menos de 50 palabras) del resultado de la verificación, apta para el público general.'
        },
        explanation_expert: {
            type: 'STRING',
            description: 'Una explicación rigurosa y detallada (entre 100 y 200 palabras) dirigida a un experto, incluyendo matices y contexto científico.'
        },
        evidenceLevel: {
            type: 'STRING',
            description: 'Nivel de evidencia (Alta, Media, Baja) para respaldar la respuesta. Evalúe la solidez de los datos disponibles.'
        },
        sources: {
            type: 'ARRAY',
            description: 'Lista de tipos de fuentes utilizadas (p.ej., Estudio Científico, Artículo de Divulgación, Declaración Oficial, Libro de Texto). Máximo 3.',
            items: { type: 'STRING' }
        },
        category: {
            type: 'STRING',
            description: 'Categoría o área temática principal del mito (p.ej., Salud, Nutrición, Climatología, Historia, Tecnología).'
        },
        relatedMyths: {
            type: 'ARRAY',
            description: 'Lista de 3 mitos o conceptos relacionados. Máximo 3.',
            items: { type: 'STRING' }
        },
    },
    required: ['myth', 'isTrue', 'explanation_simple', 'explanation_expert', 'evidenceLevel', 'sources', 'category', 'relatedMyths']
};

// Función de utilidad para sanear URLs y texto (mantener la consistencia con el frontend)
const urlLike = /(https?:\/\/|www\.)[^\s)]+/gi;
const stripUrls = (s) => typeof s === 'string' ? s.replace(urlLike, '').replace(/\(\s*\)/g, '').trim() : s;
const isUrlish = (s) => typeof s === 'string' && /(https?:\/\/|www\.)/i.test(s);

// Handler principal de Netlify Function
exports.handler = async (event, context) => {
    // Manejo de la solicitud OPTIONS para CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: cors,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: cors,
            body: JSON.stringify({ error: 'Método no permitido. Use POST.' })
        };
    }

    // 1. Validar y obtener la consulta del usuario
    let userQuery;
    try {
        const body = JSON.parse(event.body);
        userQuery = body.userQuery;
    } catch (e) {
        return {
            statusCode: 400,
            headers: cors,
            body: JSON.stringify({ error: 'Formato JSON de solicitud incorrecto.' })
        };
    }

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
        return {
            statusCode: 400,
            headers: cors,
            body: JSON.stringify({ error: 'La consulta del usuario es requerida.' })
        };
    }

    // 2. Construir el prompt y la configuración de la IA
    const systemInstruction = `Eres un experto verificador de mitos científico, riguroso y conciso. Tu tarea es analizar la afirmación del usuario, determinar si es verdadera o falsa, y generar una respuesta estrictamente en formato JSON basado en el esquema proporcionado. El mito debe ser verificado con criterio científico riguroso. NO INCLUYAS URLs, enlaces o referencias a ellos en NINGÚN campo.`;

    const contents = [
        {
            role: 'user',
            parts: [{ text: `Verifica esta afirmación: "${userQuery}"` }]
        }
    ];

    const config = {
        systemInstruction: systemInstruction,
        temperature: 0.1, // Baja temperatura para respuestas más determinísticas y rigurosas
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
    };

    // 3. Llamada a la API de Gemini
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: contents,
            config: config,
        });

        // 4. Extracción y Saneamiento del Objeto JSON (CORRECCIÓN CLAVE)
        let obj = null;
        const part = response?.candidates?.[0]?.content?.parts?.[0];

        try {
            if (part && part.hasOwnProperty('jsonObject')) {
                // Opción 1 (Preferente): El modelo devolvió el objeto JavaScript nativo
                obj = part.jsonObject;
            } else if (part && part.text) {
                // Opción 2 (Fallback): El modelo devolvió el JSON como string.
                // Aquí es donde se realiza el UNICO JSON.parse
                obj = JSON.parse(part.text);
            } else {
                throw new Error('La respuesta de la IA no contiene el JSON esperado (ni jsonObject ni text).');
            }

        } catch (parseError) {
            // Manejo de error si el JSON.parse falla o si la estructura es inválida
            return {
                statusCode: 502,
                headers: cors,
                body: JSON.stringify({ error: `La IA devolvió un JSON mal formado o incompleto: ${parseError.message}` })
            };
        }
        
        // 5. Saneamiento Anti-URL (Aplicar al objeto JSON extraído)
        const clean = {
            myth: stripUrls(obj.myth || userQuery),
            isTrue: !!obj.isTrue,
            explanation_simple: stripUrls(obj.explanation_simple || 'No se pudo generar una explicación simple fiable.'),
            explanation_expert: stripUrls(obj.explanation_expert || 'La IA no pudo generar una explicación experta bien formada.'),
            evidenceLevel: stripUrls(obj.evidenceLevel || 'Baja'),
            // Asegurar que 'sources' y 'relatedMyths' son arrays limpios
            sources: Array.isArray(obj.sources) ? obj.sources.filter(s => !isUrlish(s)).map(stripUrls) : [],
            category: stripUrls(obj.category || 'Sin Categoría'),
            relatedMyths: Array.isArray(obj.relatedMyths) ? obj.relatedMyths.filter(s => !isUrlish(s)).map(stripUrls) : []
        };
        
        // 6. Devolver el objeto saneado al frontend
        return {
            statusCode: 200,
            headers: { ...cors, 'Content-Type': 'application/json' },
            body: JSON.stringify(clean)
        };

    } catch (error) {
        console.error('Error en la llamada a la API de Gemini:', error);
        return {
            statusCode: 500,
            headers: cors,
            body: JSON.stringify({ error: `Fallo interno del servidor al comunicarse con la IA: ${error.message}` })
        };
    }
};
