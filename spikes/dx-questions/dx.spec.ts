import { test, expect } from '../harness/e2e/fixtures';

test.use({ extensionPath: 'dx-questions/extension' });

const dx = (page: any, query: string, ...args: unknown[]) =>
  page.evaluate(([query, args]: [string, unknown[]]) => (window as any).__reactdxDx[query](...args), [query, args]);

for (const port of [5118, 5119]) {
  test.describe(`React on port ${port}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`http://localhost:${port}/dx.html`);
      await page.getByTestId('why-label').waitFor();
    });

    test('reports a same-value new reference prop', async ({ page }) => {
      await page.getByTestId('why-same-ref').click();
      expect(await dx(page, 'lastReasons', 'WhyChild')).toEqual({ props: [{ key: 'style', sameValue: true }] });
    });

    test('reports a changed prop value', async ({ page }) => {
      await page.getByTestId('why-label').click();
      expect((await dx(page, 'lastReasons', 'WhyChild')).props).toContainEqual({ key: 'label', sameValue: false });
    });

    test('reports own state, context, and parent reasons', async ({ page }) => {
      await page.getByTestId('why-own').click();
      expect(await dx(page, 'lastReasons', 'WhyChild')).toEqual({ state: [0] });
      await page.getByTestId('why-context').click();
      expect((await dx(page, 'lastReasons', 'WhyChild')).context).toEqual(['WhyContext']);
      await page.getByTestId('why-parent').click();
      expect(await dx(page, 'lastReasons', 'WhyPlain')).toEqual({ parent: true });
    });

    test('reports which effect dependencies changed', async ({ page }) => {
      await page.getByTestId('effect-a').click();
      expect(await dx(page, 'lastEffects', 'EffectDeps')).toEqual([
        { index: 0, fired: true, changed: [0] },
        { index: 1, fired: false, changed: [] },
      ]);
    });

    test('detects remounts and their cause', async ({ page }) => {
      await page.getByTestId('why-label').click();
      expect(await dx(page, 'remounts')).toEqual([]);
      await page.getByTestId('remount-key').click();
      expect(await dx(page, 'remounts')).toEqual([{ name: 'RemountChild', cause: 'key', from: '0', to: '1' }]);
      await page.getByTestId('remount-wrapper').click();
      expect((await dx(page, 'remounts')).at(-1)).toEqual({ name: 'RemountChild', cause: 'ancestor-type' });
    });

    test('records where a setState came from', async ({ page }) => {
      const before = (await dx(page, 'updates')).length;
      await page.getByTestId('origin-bump').click();
      await expect.poll(async () => (await dx(page, 'updates')).length).toBeGreaterThan(before);
      const added = (await dx(page, 'updates')).slice(before);
      console.log(`port ${port}: ${added.length} update(s) recorded for 2 setState calls`);
      expect(added[0].component).toBe('OriginParent');
      expect(added[0].stack).toContain('handleBump');
      expect(added[0].stack).toContain('/src/dx.jsx');
    });

    test('lists context consumers', async ({ page }) => {
      expect((await dx(page, 'consumersOf', 'ConsumerContext')).sort()).toEqual(['ReaderA', 'ReaderB']);
    });

    test('finds a suspended boundary and what it waits on', async ({ page }) => {
      expect(await dx(page, 'suspended')).toEqual([]);
      await page.getByTestId('suspend').click();
      await page.getByTestId('suspense-fallback').waitFor({ state: 'attached' });
      const [boundary] = await dx(page, 'suspended');
      console.log(`port ${port}: suspended boundary ${JSON.stringify(boundary)}`);
      expect(boundary).toMatchObject({ boundaryOwner: 'SuspenseHost', isDxPromise: true });
      if (port === 5118) expect(boundary.thrower).toBe('Suspender');
    });
  });
}

test('lists the Server Components that rendered a client component (Next)', async ({ page }) => {
  await page.goto('http://localhost:5120/dx');
  await page.getByTestId('client-item').first().waitFor();
  const owners = await dx(page, 'serverOwners', 'ClientItem');
  console.log(`next: server owners ${JSON.stringify(owners)}`);
  expect(owners).toEqual([
    { name: 'ServerList', env: 'Server' },
    { name: 'DxPage', env: 'Server' },
    { name: 'RootLayout', env: 'Server' },
  ]);
});

for (const port of [5118, 5119]) {
  test(`no Server Components without a framework on port ${port}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}/`);
    await page.getByTestId('counter').waitFor();
    expect(await dx(page, 'serverOwners', 'Counter')).toEqual([]);
  });
}
