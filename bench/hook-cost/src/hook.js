import { instrument, isCompositeFiber, traverseRenderedFibers } from "bippy"

instrument({
  onCommitFiberRoot(_id, root) {
    let rendered = 0
    traverseRenderedFibers(root, (fiber) => {
      if (isCompositeFiber(fiber)) rendered++
    })
    window.__reactdxRendered = rendered
  },
})
