// Fails the CI build if data/family.json is broken, so a bad edit never gets deployed.
import { readFileSync, existsSync } from 'node:fs';

const errors = [];

// Encrypted mode: only the envelope can be checked (the content is ciphertext by design).
if (!existsSync('data/family.json') && existsSync('data/family.enc')) {
  try {
    const env = JSON.parse(readFileSync('data/family.enc', 'utf8'));
    if (env.v !== 1 || !env.salt || !env.iter || !env.data) throw new Error('missing fields');
    console.log('OK — encrypted data/family.enc (' + Math.round(env.data.length / 1024) + ' KB)');
    process.exit(0);
  } catch (e) {
    console.error('data/family.enc is not a valid envelope:', e.message);
    process.exit(1);
  }
}

let data;
try {
  data = JSON.parse(readFileSync('data/family.json', 'utf8'));
} catch (e) {
  console.error('data/family.json is not valid JSON:', e.message);
  process.exit(1);
}

const people = data.people ?? [];
const ids = new Set();
for (const p of people) {
  if (!p.id) errors.push(`person without id: ${JSON.stringify(p)}`);
  if (ids.has(p.id)) errors.push(`duplicate id ${p.id}`);
  ids.add(p.id);
  if (!p.name) errors.push(`${p.id}: missing name`);
  if (p.gender && !['m', 'f'].includes(p.gender)) errors.push(`${p.id}: bad gender`);
}

const byId = new Map(people.map((p) => [p.id, p]));
for (const p of people) {
  for (const k of ['parents', 'spouses']) {
    for (const r of p[k] ?? []) {
      if (!ids.has(r)) errors.push(`${p.id}: ${k} refers to unknown id ${r}`);
      if (r === p.id) errors.push(`${p.id}: refers to itself in ${k}`);
    }
  }
  if ((p.parents ?? []).length > 2) errors.push(`${p.id}: more than 2 parents`);
  for (const g of p.gallery ?? []) if (!existsSync(g)) errors.push(`${p.id}: missing gallery file ${g}`);
  for (const d of p.details ?? []) if (typeof d.k !== 'string' || typeof d.v !== 'string') errors.push(`${p.id}: bad details entry`);
  for (const m of p.media ?? []) {
    if (!['audio', 'video', 'link'].includes(m.t) || typeof m.src !== 'string') errors.push(`${p.id}: bad media entry`);
    else if (m.t !== 'link' && !existsSync(m.src)) errors.push(`${p.id}: missing media file ${m.src}`);
  }
  if (p.photo && !existsSync(p.photo)) errors.push(`${p.id}: missing photo file ${p.photo}`);
}

// a person can't be their own ancestor
function hasCycle(id, seen = new Set()) {
  if (seen.has(id)) return true;
  seen.add(id);
  return (byId.get(id)?.parents ?? []).some((x) => hasCycle(x, new Set(seen)));
}
for (const p of people) if (hasCycle(p.id)) errors.push(`${p.id}: cycle in ancestry`);

if (data.meta?.root && !ids.has(data.meta.root)) errors.push(`meta.root ${data.meta.root} not found`);

if (errors.length) {
  console.error(errors.map((e) => '✗ ' + e).join('\n'));
  process.exit(1);
}
console.log(`OK — ${people.length} people`);
