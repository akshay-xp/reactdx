export type Expected = { name: string; page: string; rendered: string; defined: string };

const shapes = (name: string, rendered: number, defined = 'src/debug-stack.jsx') => ({
  name,
  page: '/debug-stack.html',
  rendered: `src/debug-stack.jsx:${rendered}`,
  defined,
});

const nextShapes = (name: string, rendered: number) => ({
  name,
  page: '/debug-stack',
  rendered: `app/debug-stack/Shapes.jsx:${rendered}`,
  defined: 'app/debug-stack/Shapes.jsx',
});

export const expected: Record<'vite' | 'next', Expected[]> = {
  vite: [
    { name: 'App', page: '/', rendered: 'src/main.jsx:4', defined: 'src/App.jsx' },
    { name: 'Counter', page: '/', rendered: 'src/App.jsx:8', defined: 'src/Counter.jsx' },
    shapes('Root', 82),
    shapes('Plain', 61),
    shapes('Arrow', 62),
    shapes('Memoized', 63),
    shapes('Forwarded', 64),
    shapes('Klass', 65),
    shapes('NoJsx', 66),
    shapes('Item', 69),
    shapes('Wrapped', 39),
    shapes('Other', 73, 'src/shapes/Other.jsx'),
    { name: 'Nested', page: '/debug-stack.html', rendered: 'src/shapes/Other.jsx:6', defined: 'src/shapes/Other.jsx' },
    shapes('LazyThing', 75, 'src/shapes/Lazy.jsx'),
  ],
  // Shapes is created by a Server Component, the rest by client code.
  next: [
    { name: 'Shapes', page: '/debug-stack', rendered: 'app/debug-stack/page.jsx:4', defined: 'app/debug-stack/Shapes.jsx' },
    nextShapes('Plain', 30),
    nextShapes('Memoized', 31),
    nextShapes('Forwarded', 32),
    nextShapes('Klass', 33),
    nextShapes('Item', 36),
  ],
};

const NO_JSX_SOURCE = "_debugSource comes from the JSX transform's __source, so createElement calls have none";

// Misses that are real limits, each with the reason. Recorded in docs/m0-findings.md.
export const KNOWN_MISSES: Record<string, Record<string, string>> = {
  vite19: {},
  vite18: { NoJsx: NO_JSX_SOURCE },
  vite18Defined: { NoJsx: NO_JSX_SOURCE },
};
