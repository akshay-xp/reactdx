const MAX_STRING = 1000;
const MAX_DEPTH = 2;
const PAGE = 100;

function serializeNumber(value: number) {
  if (Number.isNaN(value)) return { type: 'number', value: 'NaN' };
  if (value === Infinity) return { type: 'number', value: 'Infinity' };
  if (value === -Infinity) return { type: 'number', value: '-Infinity' };
  if (Object.is(value, -0)) return { type: 'number', value: '-0' };
  return value;
}

const className = (value: object) => Object.getPrototypeOf(value)?.constructor?.name ?? null;

// Takes one page without copying the whole collection.
function pageOf<T>(iterable: Iterable<T>, offset: number) {
  const items: T[] = [];
  let index = 0;
  for (const item of iterable) {
    if (index >= offset + PAGE) return { items, nextOffset: offset + PAGE };
    if (index >= offset) items.push(item);
    index++;
  }
  return { items };
}

const REACT_ELEMENT = new Set([Symbol.for('react.element'), Symbol.for('react.transitional.element')]);

const elementName = (type: any) => (typeof type === 'string' ? type : (type?.displayName ?? type?.name ?? 'Anonymous'));

// Values that are better summarized than walked. They carry no id because there's nothing to expand.
function leaf(value: any) {
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return value instanceof Element
      // getAttribute, because an SVG element's className is an SVGAnimatedString, not a string.
      ? { type: 'element', tag: value.tagName.toLowerCase(), id: value.id, className: value.getAttribute('class') ?? '' }
      : { type: 'node', nodeName: value.nodeName };
  }
  if (REACT_ELEMENT.has(value.$$typeof)) return { type: 'react-element', name: elementName(value.type), key: value.key };
  if (value instanceof Date) return { type: 'date', iso: value.toISOString() };
  if (value instanceof RegExp) return { type: 'regexp', source: value.source, flags: value.flags };
  if (value instanceof Error) return { type: 'error', name: value.name, message: value.message };
  if (value instanceof Promise) return { type: 'promise' };
  return null;
}

function preview(value: object) {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (value instanceof Map) return { type: 'map', size: value.size };
  if (value instanceof Set) return { type: 'set', size: value.size };
  return { type: 'object', className: className(value), size: Object.keys(Object.getOwnPropertyDescriptors(value)).length };
}

export function createInspector() {
  const ids = new WeakMap<object, number>();
  const objects = new Map<number, object>();
  // Objects on the current path; meeting one again means a cycle.
  const path = new Set<object>();

  const idOf = (value: object) => {
    let id = ids.get(value);
    if (id === undefined) {
      id = objects.size + 1;
      ids.set(value, id);
      objects.set(id, value);
    }
    return id;
  };

  function contents(value: object, depth: number, offset: number) {
    const child = (item: unknown) => serialize(item, depth + 1);
    if (Array.isArray(value)) {
      const { items, nextOffset } = pageOf(value, offset);
      return { items: items.map(child), ...(nextOffset && { nextOffset }) };
    }
    if (value instanceof Map) {
      const { items, nextOffset } = pageOf(value.entries(), offset);
      return { entries: items.map(([key, item]) => [child(key), child(item)]), ...(nextOffset && { nextOffset }) };
    }
    if (value instanceof Set) {
      const { items, nextOffset } = pageOf(value.values(), offset);
      return { values: items.map(child), ...(nextOffset && { nextOffset }) };
    }
    // Reads own properties through descriptors so getters (app code) never run.
    const props: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      props[key] = 'value' in descriptor ? child(descriptor.value) : { type: 'getter' };
    }
    return { props };
  }

  function serializeObject(value: object, depth: number, offset: number) {
    const summary = leaf(value);
    if (summary) return summary;
    if (path.has(value)) return { type: 'ref', id: idOf(value), circular: true };
    if (depth >= MAX_DEPTH) return { type: 'ref', id: idOf(value), preview: preview(value) };
    path.add(value);
    try {
      return { ...preview(value), id: idOf(value), ...contents(value, depth, offset) };
    } finally {
      path.delete(value);
    }
  }

  function serialize(value: unknown, depth = 0, offset = 0): unknown {
    switch (typeof value) {
      case 'undefined':
        return { type: 'undefined' };
      case 'number':
        return serializeNumber(value);
      case 'bigint':
        return { type: 'bigint', value: String(value) };
      case 'string':
        return value.length > MAX_STRING
          ? { type: 'string', preview: value.slice(0, MAX_STRING), length: value.length }
          : value;
      case 'function':
        return { type: 'function', name: value.name };
      case 'symbol':
        return { type: 'symbol', description: value.description };
      case 'object':
        return value === null ? null : serializeObject(value, depth, offset);
      default:
        return value;
    }
  }

  return {
    serialize: (value: unknown) => serialize(value),
    expand: (id: number, offset = 0) => serialize(objects.get(id), 0, offset),
  };
}
