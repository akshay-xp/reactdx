import { test, expect } from './fixtures';

const commits = (messages: string[]) =>
  messages.filter((message) => message.startsWith('[reactdx] commit')).length;

for (const port of [5118, 5119, 5120]) {
  test(`hook is installed before React on port ${port}`, async ({ page, consoleMessages }) => {
    await page.goto(`http://localhost:${port}`);
    await expect.poll(() => consoleMessages).toContain('[reactdx] hook installed');
    expect(consoleMessages.join('\n')).not.toContain('Download the React DevTools');
  });

  test(`hook logs the initial commit on port ${port}`, async ({ page, consoleMessages }) => {
    await page.goto(`http://localhost:${port}`);
    await expect.poll(() => commits(consoleMessages)).toBeGreaterThan(0);
  });
}

test('hook logs a commit after a state update', async ({ page, consoleMessages }) => {
  await page.goto('http://localhost:5120');
  await expect.poll(() => commits(consoleMessages)).toBeGreaterThan(0);
  const before = commits(consoleMessages);
  await page.getByTestId('counter').click();
  await expect.poll(() => commits(consoleMessages)).toBeGreaterThan(before);
});
