const MAX_STRING = 1000;

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
  function serializeObject(value: object) {
    const props: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      props[key] = 'value' in descriptor ? serialize(descriptor.value) : { type: 'getter' };
    }
    return { type: 'object', className: className(value), id: idOf(value), size: Object.keys(props).length, props };
  }

  function serialize(value: unknown): unknown {
    switch (typeof value) {
      case 'function':
        return { type: 'function', name: value.name };
      case 'symbol':
        return { type: 'symbol', description: value.description };
      case 'object':
        return value === null ? null : serializeObject(value);
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
    serialize,
    expand(id: number, offset = 0): unknown {
      throw new Error('not implemented');
    },
  };
}
