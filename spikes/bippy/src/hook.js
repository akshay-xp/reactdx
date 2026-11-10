import { instrument, traverseRenderedFibers, isCompositeFiber, getDisplayName, getRenderer } from 'bippy';

let counterFiber = null;

instrument({
  onActive() {
    console.log('[reactdx:bippy] active');
  },
  onCommitFiberRoot(id, root) {
    traverseRenderedFibers(root, (fiber) => {
      if (!isCompositeFiber(fiber)) return;
      const name = getDisplayName(fiber.type);
      if (name === 'Counter') counterFiber = fiber;
      console.log(`[reactdx:bippy] rendered ${name}`);
    });
  },
});

window.__reactdxBippyEdit = (value) => {
  getRenderer(counterFiber).overrideHookState(counterFiber, 0, [], value);
};
