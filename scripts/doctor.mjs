import { probeAll } from "../runtime/adapters.mjs";

const results = await probeAll({});
console.log(JSON.stringify({
  harnesses: results.map(({ id, name, status, detail, executable, modelOptions }) => ({
    id,
    name,
    status,
    detail,
    executable: executable || null,
    models: (modelOptions || []).map(({ value, label }) => ({ value, label })),
  })),
}, null, 2));
