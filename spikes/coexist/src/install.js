// bippy's main entry imports install-hook-only, which claims the hook on window and breaks RDT.
// Its core file has the helpers without that side effect, but only under minified names (pinned 0.7.3).
import { x as traverseRenderedFibers, m as isCompositeFiber, i as getDisplayName } from 'bippy/dist/core.js';

const KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
const state = (window.__reactdxCoexist = { order: null, renderersAtInstall: null, commits: 0 });

function onCommit(root) {
  state.commits++;
  traverseRenderedFibers(root, (fiber) => {
    if (isCompositeFiber(fiber)) console.log(`[reactdx:coexist] rendered ${getDisplayName(fiber.type)}`);
  });
}

function attachTo(hook) {
  const original = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (id, root, ...rest) {
    const result = original?.call(this, id, root, ...rest);
    onCommit(root);
    return result;
  };
}

function createHook() {
  const renderers = new Map();
  return {
    renderers,
    supportsFiber: true,
    inject(renderer) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
}

function logStatus() {
  const hook = window[KEY];
  const ids = [...(hook?.rendererInterfaces?.keys() ?? [])];
  const rdtRoots = ids.reduce((sum, id) => sum + hook.getFiberRoots(id).size, 0);
  console.log(
    `[reactdx:coexist] status order=${state.order} rdtAttached=${ids.length > 0} rdtRoots=${rdtRoots} commits=${state.commits}`,
  );
}

export function install() {
  window.addEventListener('load', () => setTimeout(logStatus, 1000));

  // A hook that's already window's own property (RDT's) gets wrapped in place.
  if (Object.hasOwn(window, KEY)) {
    const hook = window[KEY];
    state.order = 'late';
    state.renderersAtInstall = hook.renderers?.size ?? 0;
    attachTo(hook);
    return;
  }

  // Otherwise live on Window.prototype: React still finds the hook through the prototype
  // chain, but RDT's `window.hasOwnProperty` checks don't, so RDT can still install its own
  // hook on window, which shadows ours. We attach to it as soon as it's defined.
  state.order = 'first';
  const hook = createHook();
  attachTo(hook);
  Object.defineProperty(Window.prototype, KEY, { configurable: true, get: () => hook });
  const defineProperty = Object.defineProperty;
  Object.defineProperty = function (target, key, descriptor) {
    const result = defineProperty(target, key, descriptor);
    if (target === window && key === KEY) attachTo(window[KEY]);
    return result;
  };
}
