import { instrument, traverseRenderedFibers, isCompositeFiber, getDisplayName } from 'bippy';

instrument({
  onActive() {
    console.log('[reactdx:bippy] active');
  },
  onCommitFiberRoot(id, root) {
    traverseRenderedFibers(root, (fiber) => {
      if (isCompositeFiber(fiber)) {
        console.log(`[reactdx:bippy] rendered ${getDisplayName(fiber.type)}`);
      }
    });
  },
});
