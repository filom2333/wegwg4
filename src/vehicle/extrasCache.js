// The procedural parts a car type adds to its model (type.extras: the engine and its ancillaries,
// the reservoirs, the tank, the spare) are the same on every car of the type, and building them
// was half the time it took to make a car (a frame's worth for every abandoned car met on the
// road). The first build of a type is recorded; later ones get copies of what it added, with
// their own materials and the references the car keeps (model.bay) pointing into the copies.

import * as THREE from 'three';

const RECORDS = new Map(); // type id -> { parts, adds, props, mats }

export function runExtras(type, model, mats) {
  if (!type.extras) return;
  const rec = RECORDS.get(type.id);
  if (rec) return replay(rec, model, mats);
  // record: what addPart was given, what was added to parts already there, what was set
  const parts = [];
  const addPart = model.addPart;
  model.addPart = function (id, object, opts = {}) {
    parts.push({ id, object, opts });
    return addPart.call(this, id, object, opts);
  };
  const before = new Map(Object.entries(model.parts).map(([id, p]) => [id, new Set(p.inner.children)]));
  const keys = new Set(Object.keys(model));
  try {
    type.extras(model, mats);
  } finally {
    delete model.addPart;
  }
  const adds = [];
  for (const [id, set] of before) for (const c of model.parts[id].inner.children) if (!set.has(c)) adds.push({ id, object: c });
  const props = {};
  for (const k of Object.keys(model)) if (!keys.has(k)) props[k] = model[k];
  // a snapshot, taken before this car wears or is painted: copies are made from it, never from
  // a car on the road
  const snap = new Map();
  const keep = (o) => {
    const c = o.clone(true);
    pair(o, c, snap);
    return c;
  };
  RECORDS.set(type.id, {
    parts: parts.map((x) => ({ ...x, object: keep(x.object) })),
    adds: adds.map((x) => ({ ...x, object: keep(x.object) })),
    props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, remap(v, snap)])),
    mats,
  });
}

function replay(rec, model, mats) {
  const map = new Map();
  // materials of the recorded car -> this car's, by their role
  const matMap = new Map();
  for (const [k, m] of Object.entries(rec.mats)) if (m && m.isMaterial && mats[k] && mats[k].isMaterial) matMap.set(m, mats[k]);
  const copy = (o) => {
    const c = o.clone(true);
    pair(o, c, map);
    c.traverse((x) => {
      if (!x.isMesh) return;
      if (Array.isArray(x.material)) x.material = x.material.map((m) => matMap.get(m) || m);
      else if (matMap.has(x.material)) x.material = matMap.get(x.material);
    });
    return c;
  };
  for (const { id, object, opts } of rec.parts) model.addPart(id, copy(object), opts);
  for (const { id, object } of rec.adds) model.parts[id].inner.add(copy(object));
  for (const [k, v] of Object.entries(rec.props)) model[k] = remap(v, map);
}

// The same object in the original and its copy, all the way down (clone keeps the order).
function pair(a, b, map) {
  map.set(a, b);
  // (userData: references into the object point into the copy; the rest is shared)
  if (a.userData && Object.keys(a.userData).length) b.userData = remap(a.userData, map, true);
  for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i], map);
}

function remap(v, map, shallow = false) {
  if (v && v.isObject3D) return map.get(v) || v;
  if (Array.isArray(v)) return v.map((x) => remap(x, map, shallow));
  if (v && typeof v === 'object' && v.constructor === Object) {
    const o = {};
    for (const k in v) o[k] = remap(v[k], map, shallow);
    return o;
  }
  if (v && v.isVector3) return v.clone();
  return v;
}
