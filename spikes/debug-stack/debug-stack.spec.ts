import { test, expect } from '@playwright/test';
import { collectComponents } from './collect.ts';

// React 18's _debugSource comes from the JSX transform, so createElement calls have none.
const NO_SOURCE_18 = ['NoJsx'];

const SHAPES = ['Root', 'Plain', 'Arrow', 'Memoized', 'Forwarded', 'Klass', 'NoJsx', 'Item', 'Wrapped', 'LazyThing', 'Other', 'Nested'];

for (const [port, field, other] of [[5119, 'stack', 'source'], [5118, 'source', 'stack']] as const) {
  test(`collects every component shape with its ${field} on port ${port}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}/debug-stack.html`);
    await page.getByTestId('ready').waitFor({ state: 'attached' });
    const components = await page.evaluate(collectComponents);
    for (const name of SHAPES) {
      const found = components.filter((component) => component.name === name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const component of found) {
        if (port === 5118 && NO_SOURCE_18.includes(name)) expect(component.source, name).toBeNull();
        else expect(component[field], name).not.toBeNull();
        expect(component[other], name).toBeNull();
      }
    }
    expect(components.filter((component) => component.name === 'Item')).toHaveLength(3);
  });
}
