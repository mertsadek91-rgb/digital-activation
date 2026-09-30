// A small JSON Schema subset validator — enough to keep state writes from
// drifting: type, enum, const, required, properties, additionalProperties,
// items, pattern, minimum, maximum, minLength, and $ref into enums.json
// ("enums.json#/task_status") or into the schema's own $defs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AOS } from './paths.mjs';

let enumsCache = null;
export function enums() {
  enumsCache ??= JSON.parse(readFileSync(join(AOS, 'policies', 'enums.json'), 'utf8'));
  return enumsCache;
}

const schemaCache = new Map();
export function schema(name) {
  if (!schemaCache.has(name))
    schemaCache.set(name, JSON.parse(readFileSync(join(AOS, 'schemas', `${name}.schema.json`), 'utf8')));
  return schemaCache.get(name);
}

function resolve(ref, root) {
  if (ref.startsWith('enums.json#/')) {
    const key = ref.slice('enums.json#/'.length);
    const values = enums()[key];
    if (!values) throw new Error(`unknown enum ${key}`);
    return { enum: values };
  }
  if (ref.startsWith('#/$defs/')) return root.$defs[ref.slice(8)];
  throw new Error(`unsupported $ref ${ref}`);
}

const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

export function validate(value, s, path = '', root = s, errors = []) {
  if (s.$ref) return validate(value, resolve(s.$ref, root), path, root, errors);
  if (s.anyOf) {
    const ok = s.anyOf.some((alt) => validate(value, alt, path, root, []).length === 0);
    if (!ok) errors.push(`${path || 'value'}: does not match any allowed shape`);
    return errors;
  }
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const t = typeOf(value);
    const ok = types.some((x) => x === t || (x === 'number' && t === 'integer'));
    if (!ok) {
      errors.push(`${path || 'value'}: expected ${types.join('|')}, got ${t}`);
      return errors;
    }
  }
  if (s.const !== undefined && value !== s.const) errors.push(`${path}: must be ${s.const}`);
  if (s.enum && value !== null && !s.enum.includes(value))
    errors.push(`${path || 'value'}: "${value}" is not one of ${s.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${path}: "${value}" does not match ${s.pattern}`);
    if (s.minLength && value.length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
  }
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) errors.push(`${path}: below ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) errors.push(`${path}: above ${s.maximum}`);
  }
  if (Array.isArray(value) && s.items) value.forEach((v, i) => validate(v, s.items, `${path}[${i}]`, root, errors));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of s.required ?? [])
      if (value[r] === undefined || value[r] === null) errors.push(`${path ? path + '.' : ''}${r}: required`);
    for (const [k, v] of Object.entries(value)) {
      const ps = s.properties?.[k];
      if (ps) validate(v, ps, path ? `${path}.${k}` : k, root, errors);
      else if (s.additionalProperties === false) errors.push(`${path ? path + '.' : ''}${k}: unknown field`);
    }
  }
  return errors;
}
