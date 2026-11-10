import { test, expect } from '@playwright/test';

for (const port of [5118, 5119]) {
  test(`bench page renders 10k cells on port ${port}`, async ({ page }) => {
    await page.goto(`http://localhost:${port}/bench.html`);
    await expect(page.getByTestId('cell')).toHaveCount(10000);
  });
}

const cellValues = (page) =>
  page.getByTestId('cell').evaluateAll((cells) => cells.map((cell) => cell.textContent));

for (const port of [5118, 5119]) {
  test(`__bench times commits on port ${port}`, async ({ page }) => {
    const url = `http://localhost:${port}/bench.html`;

    await page.goto(url);
    await expect(page.getByTestId('cell')).toHaveCount(10000);
    const all = await page.evaluate(() => (window as any).__bench('all', 5));
    expect(all).toHaveLength(5);
    expect(all.every((ms: number) => ms > 0)).toBe(true);
    expect(new Set(await cellValues(page))).toEqual(new Set(['5']));

    await page.goto(url);
    await expect(page.getByTestId('cell')).toHaveCount(10000);
    const one = await page.evaluate(() => (window as any).__bench('one', 5));
    expect(one).toHaveLength(5);
    expect(one.every((ms: number) => ms > 0)).toBe(true);
    const values = await cellValues(page);
    expect(values[0]).toBe('5');
    expect(new Set(values.slice(1))).toEqual(new Set(['0']));
  });
}
