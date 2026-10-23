// Model-management parsing for CCHH's real APIs. The phone keeps no catalog
// of its own: every row here comes from the desktop and is re-read after each
// switch to prove both ends agree. Pure functions; tested in tests/modelCatalog.test.mjs.

export const MODEL_SLOTS = ['main','fable','haiku','sonnet','opus'];

export const SLOT_LABELS = {
  main:'主模型', fable:'Fable', haiku:'Haiku', sonnet:'Sonnet', opus:'Opus',
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// GET /api/providers → {providers:[{id,name,apiFormat,models:{slot:modelId}}], activeId}
export function parseProviders(payload) {
  const list = Array.isArray(payload?.providers) ? payload.providers : [];
  const activeId = str(payload?.activeId) || null;
  return {
    activeId,
    providers: list
      .filter(p => p && str(p.id))
      .map(p => {
        const slots = {};
        for (const slot of MODEL_SLOTS) {
          const value = str(p.models?.[slot]);
          if (value) slots[slot] = value;
        }
        return {
          id: str(p.id),
          name: str(p.name) || str(p.id),
          apiFormat: str(p.apiFormat),
          slots,
          isActive: str(p.id) === activeId,
        };
      }),
  };
}

// GET /api/models → {models:[{id,name,description,context,...}], provider}
export function parseModels(payload) {
  return (Array.isArray(payload?.models) ? payload.models : [])
    .filter(m => m && str(m.id))
    .map(m => ({
      id: str(m.id),
      name: str(m.name) || str(m.id),
      description: str(m.description),
      context: str(m.context),
    }));
}

// GET /api/models/current → {model:{id,name,...}}
export function parseCurrent(payload) {
  const model = payload?.model;
  if (!model || !str(model.id)) return null;
  return { id: str(model.id), name: str(model.name) || str(model.id) };
}

// GET /api/effort → {level, available:[...]}
export function parseEffort(payload) {
  const available = Array.isArray(payload?.available)
    ? payload.available.filter(v => typeof v === 'string' && v)
    : [];
  return { level: str(payload?.level) || null, available };
}

// CCHH may answer with a tier suffix (`auto[1m]`) or a different case; compare
// the base id so a successful switch is not reported as a failure.
export function sameModel(a, b) {
  const norm = (v) => str(v).toLowerCase().replace(/\[1m\]$/,'');
  const x = norm(a), y = norm(b);
  return Boolean(x) && x === y;
}

// Slots currently bound to a model id, for the provider row summary.
export function slotsForModel(provider, modelId) {
  if (!provider?.slots) return [];
  return MODEL_SLOTS
    .filter(slot => sameModel(provider.slots[slot], modelId))
    .map(slot => SLOT_LABELS[slot] || slot);
}