<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Desmitificador Plus</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900">
  <main class="max-w-3xl mx-auto px-4 py-8">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold">Desmitificador Plus</h1>
      <p class="text-slate-600">Escribe una afirmación y te devuelvo un veredicto con nivel de evidencia y resumen.</p>
    </header>

    <!-- Formulario -->
    <form id="mythForm" class="flex gap-2 mb-6">
      <input id="mythInput" type="text" placeholder="Ej.: Las duchas frías post-entreno frenan la hipertrofia"
             class="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-slate-400" />
      <button type="submit"
              class="rounded-lg bg-slate-900 text-white px-4 py-2 hover:bg-slate-800 active:scale-[0.99]">
        Verificar evidencia
      </button>
    </form>

    <!-- Sugerencias -->
    <div class="mb-6 flex flex-wrap gap-2">
      <button class="suggestion-btn text-sm px-3 py-1 rounded-full bg-slate-200 hover:bg-slate-300">La sal sube siempre la tensión</button>
      <button class="suggestion-btn text-sm px-3 py-1 rounded-full bg-slate-200 hover:bg-slate-300">Cardio en ayunas quema más grasa</button>
      <button class="suggestion-btn text-sm px-3 py-1 rounded-full bg-slate-200 hover:bg-slate-300">Las proteínas dañan el riñón</button>
    </div>

    <!-- Loader -->
    <div id="loader" class="hidden">
      <div class="flex items-center gap-3 text-slate-600">
        <svg xmlns="http://www.w3.org/2000/svg" class="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"></circle>
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="4"></path>
        </svg>
        Procesando…
      </div>
    </div>

    <!-- Resultados -->
    <section id="results" class="space-y-4 mt-6"></section>

    <!-- Estado inicial -->
    <p id="initial-state" class="text-slate-500 mt-8">Escribe una afirmación arriba o pulsa una sugerencia para empezar.</p>
  </main>

  <script>
    // --- Referencias DOM
    const form = document.getElementById('mythForm');
    const input = document.getElementById('mythInput');
    const loader = document.getElementById('loader');
    const results = document.getElementById('results');
    const initialState = document.getElementById('initial-state');

    // --- Utilidades UI
    const show = el => el && el.classList.remove('hidden');
    const hide = el => el && el.classList.add('hidden');

    function colorForVerdict(verdict) {
      const v = (verdict || '').toLowerCase();
      if (v.includes('verdadero') || v.includes('cierto')) return 'bg-green-100 text-green-800';
      if (v.includes('parcial') || v.includes('depende')) return 'bg-amber-100 text-amber-900';
      if (v.includes('no concluyente') || v.includes('incierto')) return 'bg-slate-200 text-slate-800';
      return 'bg-red-100 text-red-800'; // Falso por defecto
    }

    function evidenciometro(level) {
      const L = (level || '').toLowerCase();
      if (L.includes('alta')) return '🟢 Alta';
      if (L.includes('moderada')) return '🟠 Moderada';
      return '🔴 Baja';
    }

    function normalizeResult(r) {
      if (!r || typeof r !== 'object') return {};
      const evidenceLevel = r.evidence_level ?? r.evidenceLevel ?? '';
      return {
        claim: r.claim ?? '',
        verdict: r.verdict ?? '',
        summary: r.summary ?? '',
        evidenceLevel,
        citations: Array.isArray(r.citations) ? r.citations : []
      };
    }

    function renderResultCard(res) {
      const n = normalizeResult(res);
      const verdictClass = colorForVerdict(n.verdict);

      const cites = n.citations.length
        ? `<div class="mt-3 text-sm">
             <span class="font-medium">Citas/Fuentes:</span>
             <ul class="list-disc pl-5 mt-1 space-y-1">${n.citations.map(c => `<li class="break-words"><a class="underline" href="${c}" target="_blank" rel="noopener">${c}</a></li>`).join('')}</ul>
           </div>`
        : '';

      return `
        <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          ${n.claim ? `<div class="text-slate-500 text-sm mb-1">Afirmación</div><h2 class="text-lg font-medium mb-3">${n.claim}</h2>` : ''}
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span class="text-xs px-2 py-1 rounded-full ${verdictClass}">Veredicto: ${n.verdict || '—'}</span>
            <span class="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-800">Evidencia: ${evidenciometro(n.evidenceLevel)}</span>
          </div>
          <p class="text-slate-800 leading-relaxed">${n.summary || 'Sin resumen.'}</p>
          ${cites}
        </article>
      `;
    }

    async function verify(query) {
      const endpoint = '/.netlify/functions/verifyMyth';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userQuery: query })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Error HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data?.data ?? data; // backend devuelve { ok:true, data: {...} }
    }

    async function handleSubmit(query) {
      if (!query) return;
      results.innerHTML = '';
      hide(initialState);
      show(loader);
      try {
        const payload = await verify(query);
        results.innerHTML = renderResultCard(payload);
      } catch (err) {
        results.innerHTML = `
          <div class="rounded-lg border border-red-300 bg-red-50 text-red-800 p-4">
            <div class="font-medium mb-1">No he podido verificar la afirmación.</div>
            <div class="text-sm">${(err && err.message) || 'Error desconocido.'}</div>
          </div>`;
      } finally {
        hide(loader);
      }
    }

    // Eventos
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit((input.value || '').trim());
    });

    document.querySelectorAll('.suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => handleSubmit(btn.textContent.trim()));
    });
  </script>
</body>
</html>
