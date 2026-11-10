const MAX_STRING = 1000;
const MAX_DEPTH = 2;

function serializeNumber(value: number) {
  if (Number.isNaN(value)) return { type: 'number', value: 'NaN' };
  if (value === Infinity) return { type: 'number', value: 'Infinity' };
  if (value === -Infinity) return { type: 'number', value: '-Infinity' };
  if (Object.is(value, -0)) return { type: 'number', value: '-0' };
  return value;
}

const className = (value: object) => Object.getPrototypeOf(value)?.constructor?.name ?? null;

export function createInspector() {
  const ids = new WeakMap<object, number>();
  const objects = new Map<number, object>();

  const idOf = (value: object) => {
    let id = ids.get(value);
    if (id === undefined) {
      id = objects.size + 1;
      ids.set(value, id);
      objects.set(id, value);
    }
    return id;
  };

  // Reads own properties through descriptors so getters (app code) never run.
  // Objects on the current path; meeting one again means a cycle.
  const path = new Set<object>();

  function serializeObject(value: object, depth: number) {
    if (path.has(value)) return { type: 'ref', id: idOf(value), circular: true };
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (depth >= MAX_DEPTH) {
      return { type: 'ref', id: idOf(value), preview: { type: 'object', className: className(value), size: descriptors.length } };
    }
    const props: Record<string, unknown> = {};
    path.add(value);
    for (const [key, descriptor] of descriptors) {
      props[key] = 'value' in descriptor ? serialize(descriptor.value, depth + 1) : { type: 'getter' };
    }
    path.delete(value);
    return { type: 'object', className: className(value), id: idOf(value), size: descriptors.length, props };
  }

  function serialize(value: unknown, depth = 0): unknown {
    switch (typeof value) {
      case 'function':
        return { type: 'function', name: value.name };
      case 'symbol':
        return { type: 'symbol', description: value.description };
      case 'object':
        return value === null ? null : serializeObject(value, depth);
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
      default:
        return value;
    }
  }

  return {
    serialize: (value: unknown) => serialize(value),
    expand(id: number, offset = 0): unknown {
      return serialize(objects.get(id));
    },
  };
}
