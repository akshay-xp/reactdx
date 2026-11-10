const MAX_STRING = 1000;

function serializeNumber(value: number) {
  if (Number.isNaN(value)) return { type: 'number', value: 'NaN' };
  if (value === Infinity) return { type: 'number', value: 'Infinity' };
  if (value === -Infinity) return { type: 'number', value: '-Infinity' };
  if (Object.is(value, -0)) return { type: 'number', value: '-0' };
  return value;
}

export function createInspector() {
  function serialize(value: unknown): unknown {
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
