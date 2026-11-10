import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHook } from '../src/hook.ts';

test('installs a hook React accepts', () => {
  const target: { __REACT_DEVTOOLS_GLOBAL_HOOK__?: any } = {};
  installHook(target);
  const hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  assert.equal(hook.supportsFiber, true);
  for (const name of ['checkDCE', 'onCommitFiberRoot', 'onCommitFiberUnmount', 'onPostCommitFiberRoot']) {
    assert.equal(typeof hook[name], 'function', name);
  }
  const rendererA = {};
  const rendererB = {};
  assert.equal(hook.inject(rendererA), 1);
  assert.equal(hook.inject(rendererB), 2);
  assert.equal(hook.renderers.get(1), rendererA);
});
