export type Expected = { name: string; page: string; rendered: string; defined: string };

const shapes = (name: string, rendered: number, defined = 'src/debug-stack.jsx') => ({
  name,
  page: '/debug-stack.html',
  rendered: `src/debug-stack.jsx:${rendered}`,
  defined,
});

export const expected: Record<'vite', Expected[]> = {
  vite: [
    { name: 'App', page: '/', rendered: 'src/main.jsx:4', defined: 'src/App.jsx' },
    { name: 'Counter', page: '/', rendered: 'src/App.jsx:8', defined: 'src/Counter.jsx' },
    shapes('Root', 74),
    shapes('Plain', 54),
    shapes('Arrow', 55),
    shapes('Memoized', 56),
    shapes('Forwarded', 57),
    shapes('Klass', 58),
    shapes('NoJsx', 59),
    shapes('Item', 62),
    shapes('Wrapped', 39),
    shapes('Other', 66, 'src/shapes/Other.jsx'),
    { name: 'Nested', page: '/debug-stack.html', rendered: 'src/shapes/Other.jsx:6', defined: 'src/shapes/Other.jsx' },
    shapes('LazyThing', 68, 'src/shapes/Lazy.jsx'),
  ],
};

const NO_JSX_SOURCE = "_debugSource comes from the JSX transform's __source, so createElement calls have none";

// Misses that are real limits, each with the reason. Recorded in docs/m0-findings.md.
export const KNOWN_MISSES: Record<string, Record<string, string>> = {
  vite19: {},
  vite18: { NoJsx: NO_JSX_SOURCE },
  vite18Defined: { NoJsx: NO_JSX_SOURCE },
};
