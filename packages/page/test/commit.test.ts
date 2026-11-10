import { expect, test, vi } from 'vitest';
import React from 'react';
import { installHook } from '../src/hook.ts';

test('runs on the React version of its project', () => {
  expect(React.version.startsWith(process.env.REACT_VERSION!)).toBe(true);
});

test('a React root commits through the hook', async () => {
  installHook(globalThis);
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const onCommit = vi.spyOn(hook, 'onCommitFiberRoot');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // react-dom registers with the hook as it loads, so it's imported after installHook.
  const { createRoot } = await import('react-dom/client');

  const div = document.createElement('div');
  const root = createRoot(div);
  await React.act(() => root.render(React.createElement('p', null, 'hi')));

  expect(hook.renderers.size).toBe(1);
  expect(hook.renderers.get(1).version).toBe(React.version);
  const [id, fiberRoot] = onCommit.mock.calls[0];
  expect(id).toBe(1);
  expect(fiberRoot.current.tag).toBe(3); // HostRoot
  expect(div.textContent).toBe('hi');
});
