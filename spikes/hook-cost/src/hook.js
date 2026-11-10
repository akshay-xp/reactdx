import { instrument, traverseRenderedFibers, isCompositeFiber } from 'bippy';

instrument({
  onCommitFiberRoot(id, root) {
    let rendered = 0;
    traverseRenderedFibers(root, (fiber) => {
      if (isCompositeFiber(fiber)) rendered++;
    });
    window.__reactdxRendered = rendered;
  },
});
