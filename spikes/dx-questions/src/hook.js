const PERFORMED_WORK = 1;

const nameOf = (type) => {
  if (typeof type === 'function') return type.displayName ?? type.name;
  if (type && typeof type === 'object') return type.displayName ?? nameOf(type.type ?? type.render);
  return null;
};

// Function and class components, plus memo/forwardRef wrappers.
const isComposite = ({ type }) => typeof type === 'function' || !!(type && typeof type === 'object' && (type.type ?? type.render));

// fiber and alternate swap every commit; both map to one id so a component keeps it.
const ids = new WeakMap();
let nextId = 1;
const idOf = (fiber) => {
  let id = ids.get(fiber) ?? (fiber.alternate && ids.get(fiber.alternate));
  if (id === undefined) id = nextId++;
  ids.set(fiber, id);
  if (fiber.alternate) ids.set(fiber.alternate, id);
  return id;
};

function sameValue(a, b, depth = 3) {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && sameValue(a[key], b[key], depth - 1));
}

function propReasons(fiber) {
  const next = fiber.memoizedProps ?? {};
  const prev = fiber.alternate.memoizedProps ?? {};
  const changed = [];
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (key === 'children' || Object.is(prev[key], next[key])) continue;
    changed.push({ key, sameValue: sameValue(prev[key], next[key]) });
  }
  return changed;
}

// Walks two linked lists side by side (hooks, context dependencies).
function* pairs(next, prev) {
  for (let index = 0; next; index++, next = next.next, prev = prev?.next) yield [next, prev, index];
}

// Only useState/useReducer hooks have a queue; their memoizedState is the state.
function stateReasons(fiber) {
  if (typeof fiber.type !== 'function' || fiber.type.prototype?.isReactComponent) return [];
  const changed = [];
  for (const [hook, prev, index] of pairs(fiber.memoizedState, fiber.alternate.memoizedState)) {
    if (hook.queue && !Object.is(hook.memoizedState, prev?.memoizedState)) changed.push(index);
  }
  return changed;
}

function contextReasons(fiber) {
  const changed = [];
  for (const [dep, prev] of pairs(fiber.dependencies?.firstContext, fiber.alternate.dependencies?.firstContext)) {
    if (!Object.is(dep.memoizedValue, prev?.memoizedValue)) changed.push(dep.context.displayName ?? 'Context');
  }
  return changed;
}

const HAS_EFFECT = 1;

// updateQueue.lastEffect is a circular list; lastEffect.next is the first effect.
function effectList(fiber) {
  const last = fiber?.updateQueue?.lastEffect;
  const effects = [];
  for (let effect = last?.next; effect; effect = effect === last ? null : effect.next) effects.push(effect);
  return effects;
}

function effectChanges(fiber) {
  const prev = effectList(fiber.alternate);
  return effectList(fiber).map((effect, index) => ({
    index,
    fired: (effect.tag & HAS_EFFECT) !== 0,
    changed: (effect.deps ?? []).flatMap((dep, i) => (Object.is(dep, prev[index]?.deps?.[i]) ? [] : [i])),
  }));
}

function reasonsFor(fiber) {
  const reasons = {};
  for (const [kind, list] of [['props', propReasons(fiber)], ['state', stateReasons(fiber)], ['context', contextReasons(fiber)]]) {
    if (list.length) reasons[kind] = list;
  }
  if (!Object.keys(reasons).length) reasons.parent = true;
  return reasons;
}

const commits = [];
const remounts = [];
let unmounted = [];

const parentId = (fiber) => {
  for (let parent = fiber.return; parent; parent = parent.return) if (isComposite(parent)) return idOf(parent);
  return null;
};

// A fiber with no alternate that we've never seen is a fresh mount (a bailed-out fiber keeps alternate null).
function recordRemount(fiber) {
  const parent = parentId(fiber);
  const match = unmounted.find((u) => u.type === fiber.type && u.parentId === parent);
  if (!match) return;
  remounts.push(
    match.key !== fiber.key
      ? { name: nameOf(fiber.type), cause: 'key', from: match.key, to: fiber.key }
      : { name: nameOf(fiber.type), cause: 'ancestor-type' },
  );
}

function walk(fiber, visit) {
  for (; fiber; fiber = fiber.sibling) {
    visit(fiber);
    walk(fiber.child, visit);
  }
}

const updates = [];

// React 19 dev builds call console.createTask("setState()") inside the first blocking update of a batch.
// React reads console.createTask when its module loads, so wrapping it here (document_start) is in time.
const UPDATE_TASKS = new Set(['setState()', 'dispatch()', 'forceUpdate()']);
const createTask = console.createTask;
if (createTask) {
  console.createTask = function (name) {
    if (UPDATE_TASKS.has(name)) updates.push({ component: null, stack: new Error().stack });
    return createTask.call(this, name);
  };
}

// React 19's task carries no fiber, so name the component whose state changed in the next commit.
function nameUpdates(entries) {
  const changed = entries.find((entry) => entry.reasons.state);
  for (const update of updates) if (update.component === null && changed) update.component = changed.name;
}

let nextRendererId = 1;
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  supportsFiber: true,
  inject(renderer) {
    const id = nextRendererId++;
    // React 18 dev builds offer profiling hooks; markStateUpdateScheduled runs inside every setState.
    renderer.injectProfilingHooks?.({
      markStateUpdateScheduled(fiber) {
        updates.push({ component: nameOf(fiber.type), stack: new Error().stack });
      },
    });
    this.renderers.set(id, renderer);
    return id;
  },
  onCommitFiberRoot(id, root) {
    const entries = [];
    walk(root.current.child, (fiber) => {
      if (!isComposite(fiber)) return;
      if (!fiber.alternate && !ids.has(fiber)) {
        idOf(fiber);
        recordRemount(fiber);
        return;
      }
      if (!fiber.alternate || !(fiber.flags & PERFORMED_WORK)) return;
      entries.push({ id: idOf(fiber), name: nameOf(fiber.type), reasons: reasonsFor(fiber), effects: effectChanges(fiber) });
    });
    commits.push(entries);
    nameUpdates(entries);
    unmounted = [];
  },
  onCommitFiberUnmount(id, fiber) {
    if (isComposite(fiber)) unmounted.push({ type: fiber.type, key: fiber.key, parentId: parentId(fiber) });
  },
  onPostCommitFiberRoot() {},
  checkDCE() {},
};

const latest = (name) => {
  for (let i = commits.length - 1; i >= 0; i--) {
    const entry = commits[i].find((e) => e.name === name);
    if (entry) return entry;
  }
  return null;
};

window.__reactdxDx = {
  lastReasons: (name) => latest(name)?.reasons ?? null,
  lastEffects: (name) => latest(name)?.effects ?? null,
  remounts: () => remounts,
  updates: () => updates,
};
