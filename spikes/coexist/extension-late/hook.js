(() => {
  // node_modules/.pnpm/bippy@0.7.3_@types+react@19.3.0_react@19.3.1/node_modules/bippy/dist/rdt-hook.js
  var e = `0.7.3`;
  var t = `bippy-${e}`;
  var n = Object.defineProperty;
  var r = () => {
  };
  var i = (e2) => e2.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  var a = (e2) => Object.assign(e2, { [Symbol.dispose]: e2 });
  var o = (e2) => {
    let t2 = e2.current.memoizedState;
    return t2 === null || t2 !== void 0 && (t2.element === null || t2.element === void 0);
  };
  var s = (e2) => {
    try {
      Function.prototype.toString.call(e2).indexOf(`^_^`) > -1 && setTimeout(() => {
        throw Error(`React is running in production mode, but dead code elimination has not been applied. Read how to correctly configure React for production: https://react.dev/link/perf-use-production-build`);
      });
    } catch {
    }
  };
  var c = (e2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) => !!(e2 && `getFiberRoots` in e2 && e2._isBippyHook !== true);
  var l = (e2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) => {
    if (!e2 || typeof e2.inject != `function` || c(e2)) return false;
    try {
      return Function.prototype.toString.call(e2.inject).includes(`(injected)`);
    } catch {
      return false;
    }
  };
  var u = /* @__PURE__ */ new Set();
  var d = /* @__PURE__ */ new Set();
  var f = /* @__PURE__ */ new WeakMap();
  var p = /* @__PURE__ */ new Set();
  var m = /* @__PURE__ */ new Set();
  var h = /* @__PURE__ */ new WeakMap();
  var g = (e2, t2) => {
    u.add(e2);
    let n2 = f.get(e2) ?? /* @__PURE__ */ new Set();
    n2.add(t2), f.set(e2, n2);
  };
  var v = (e2) => {
    for (let t2 of u) f.get(t2)?.has(e2) && t2();
  };
  var y = (e2, t2) => {
    for (let n2 of p) n2.target === e2 && n2.listener(t2);
  };
  var b = (e2, t2) => {
    for (let n2 of m) n2(e2, t2);
  };
  var S = (e2) => (m.add(e2), a(() => {
    m.delete(e2);
  }));
  var C = (e2) => Object.prototype.toString.call(e2) === `[object Map]`;
  var w = (e2) => (C(e2.renderers) || (e2.renderers = /* @__PURE__ */ new Map()), e2.renderers);
  var T = (e2, t2, n2, r2, i2) => {
    n2.set(r2, i2), d.add(i2), e2._instrumentationIsActive || (e2._instrumentationIsActive = true, v(t2));
    let a2 = h.get(t2) ?? /* @__PURE__ */ new WeakSet();
    h.set(t2, a2), !a2.has(i2) && (a2.add(i2), y(t2, i2));
  };
  var E = (e2, i2 = globalThis) => {
    e2 && g(e2, i2);
    let a2 = /* @__PURE__ */ new Map(), c3 = /* @__PURE__ */ new Map(), l3 = (e3) => {
      let t2 = c3.get(e3) ?? /* @__PURE__ */ new Set();
      return c3.set(e3, t2), t2;
    }, u3 = 0, f3 = { _instrumentationIsActive: false, _instrumentationSource: t, _isBippyHook: true, checkDCE: s, getFiberRoots: l3, hasUnsupportedRendererAttached: false, inject: (e3) => {
      let t2 = ++u3;
      return T(f3, i2, a2, t2, e3), t2;
    }, on: r, onCommitFiberRoot: (e3, t2) => {
      let n2 = l3(e3);
      o(t2) ? n2.delete(t2) : n2.add(t2);
    }, onCommitFiberUnmount: r, onPostCommitFiberRoot: r, renderers: a2, supportsFiber: true, supportsFlight: true };
    try {
      if (n(i2, `__REACT_DEVTOOLS_GLOBAL_HOOK__`, { configurable: true, enumerable: true, get: () => f3, set: (t2) => {
        if (t2 && typeof t2 == `object`) {
          let n2 = f3.renderers;
          f3 = t2;
          let r2 = w(f3);
          n2.forEach((e3, t3) => {
            d.add(e3), r2.set(t3, e3);
          }), (n2.size > 0 || m.size > 0) && D(e2, i2), b(f3, i2);
        }
      } }), i2 === globalThis && typeof window < `u`) {
        let e3 = window.hasOwnProperty.bind(window), t2 = Object.getOwnPropertyDescriptor(window, `hasOwnProperty`), r2 = false, i3 = () => {
          t2 ? n(window, `hasOwnProperty`, t2) : Reflect.deleteProperty(window, `hasOwnProperty`);
        };
        n(window, `hasOwnProperty`, { configurable: true, value: (t3) => !r2 && t3 === `__REACT_DEVTOOLS_GLOBAL_HOOK__` ? (r2 = true, i3(), globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = void 0, false) : e3(t3), writable: true });
      }
    } catch {
      D(e2, i2);
    }
    return f3;
  };
  var D = (e2, n2 = globalThis) => {
    e2 && g(e2, n2);
    let a2 = false, o2 = i(n2);
    if (!o2) return;
    let u3 = w(o2);
    if (!o2._instrumentationSource) {
      o2.checkDCE = s, o2.supportsFiber = true, o2.supportsFlight = true, o2.hasUnsupportedRendererAttached = false, o2._instrumentationSource = t, o2._instrumentationIsActive = false;
      let e3 = c(o2);
      e3 || (o2.on = r), u3.size ? (u3.forEach((e4) => d.add(e4)), o2._instrumentationIsActive = true, v(n2), a2 = true) : !e3 && l(o2) && (o2._instrumentationIsActive = true, v(n2), a2 = true);
      let i2 = o2.inject;
      o2.inject = (e4) => {
        let t2 = i2.call(o2, e4);
        return T(o2, n2, u3, t2, e4), t2;
      };
    }
    !a2 && (u3.size || o2._instrumentationIsActive) && e2?.();
  };
  var O = (e2 = globalThis) => Object.hasOwn(e2, `__REACT_DEVTOOLS_GLOBAL_HOOK__`);
  var k = (e2, t2 = globalThis) => O(t2) ? (D(e2, t2), i(t2) ?? E(e2, t2)) : E(e2, t2);

  // node_modules/.pnpm/bippy@0.7.3_@types+react@19.3.0_react@19.3.1/node_modules/bippy/dist/core.js
  var ne = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  var s2 = /^\d+$/;
  var re = (e2) => c2(e2) !== null;
  var c2 = (e2) => {
    let t2 = ne.exec(e2);
    if (!t2) return null;
    let n2 = t2[4]?.split(`.`) ?? [];
    return n2.some((e3) => s2.test(e3) && e3.length > 1 && e3.startsWith(`0`)) ? null : { major: t2[1], minor: t2[2], patch: t2[3], prerelease: n2 };
  };
  var l2 = (e2, t2) => e2.length === t2.length ? e2 === t2 ? 0 : e2 < t2 ? -1 : 1 : e2.length < t2.length ? -1 : 1;
  var ie = (e2, t2) => {
    let n2 = s2.test(e2), r2 = s2.test(t2);
    return n2 && r2 ? l2(e2, t2) : n2 === r2 ? e2 === t2 ? 0 : e2 < t2 ? -1 : 1 : n2 ? -1 : 1;
  };
  var ae = (e2, t2) => {
    if (e2.length === 0 || t2.length === 0) return e2.length === t2.length ? 0 : e2.length === 0 ? 1 : -1;
    let n2 = Math.max(e2.length, t2.length);
    for (let r2 = 0; r2 < n2; r2++) {
      let n3 = e2[r2], i2 = t2[r2];
      if (n3 === void 0 || i2 === void 0) return n3 === void 0 ? -1 : 1;
      let a2 = ie(n3, i2);
      if (a2 !== 0) return a2;
    }
    return 0;
  };
  var u2 = (e2, t2) => {
    let n2 = c2(e2), r2 = c2(t2);
    if (!n2 || !r2) return null;
    let i2 = l2(n2.major, r2.major);
    if (i2 !== 0) return i2;
    let a2 = l2(n2.minor, r2.minor);
    if (a2 !== 0) return a2;
    let o2 = l2(n2.patch, r2.patch);
    return o2 === 0 ? ae(n2.prerelease, r2.prerelease) : o2;
  };
  var f2 = { ChildDeletion: 16, Cloned: 8, ContentReset: 32, Hydrating: 4096, PerformedWork: 1, Placement: 2, Snapshot: 1024, Update: 4, Visibility: 8192 };
  var p2 = { CONCURRENT_MODE_NUMBER: 60111, CONCURRENT_MODE_SYMBOL_DESCRIPTION: `react.concurrent_mode`, CONCURRENT_MODE_SYMBOL_STRING: `Symbol(react.concurrent_mode)`, DEPRECATED_ASYNC_MODE_SYMBOL_DESCRIPTION: `react.async_mode`, DEPRECATED_ASYNC_MODE_SYMBOL_STRING: `Symbol(react.async_mode)`, ELEMENT_SYMBOL_STRING: `Symbol(react.transitional.element)`, LEGACY_ELEMENT_SYMBOL_STRING: `Symbol(react.element)` };
  var m2 = /* @__PURE__ */ ((e2) => e2)({ "16.0.0": { ActivityComponent: -1, CacheComponent: -1, ClassComponent: 2, ContextConsumer: 12, ContextProvider: 13, CoroutineComponent: 7, CoroutineHandlerPhase: 8, DehydratedSuspenseComponent: -1, ForwardRef: 14, Fragment: 10, FunctionComponent: 1, HostComponent: 5, HostHoistable: -1, HostPortal: 4, HostRoot: 3, HostSingleton: -1, HostText: 6, IncompleteClassComponent: -1, IncompleteFunctionComponent: -1, IndeterminateComponent: 0, LazyComponent: -1, LegacyHiddenComponent: -1, MemoComponent: -1, Mode: 11, OffscreenComponent: -1, Profiler: 15, ScopeComponent: -1, SimpleMemoComponent: -1, SuspenseComponent: 16, SuspenseListComponent: -1, Throw: -1, TracingMarkerComponent: -1, ViewTransitionComponent: -1, YieldComponent: 9 }, "16.4.3-alpha": { ActivityComponent: -1, CacheComponent: -1, ClassComponent: 2, ContextConsumer: 11, ContextProvider: 12, CoroutineComponent: -1, CoroutineHandlerPhase: -1, DehydratedSuspenseComponent: -1, ForwardRef: 13, Fragment: 9, FunctionComponent: 0, HostComponent: 7, HostHoistable: -1, HostPortal: 6, HostRoot: 5, HostSingleton: -1, HostText: 8, IncompleteClassComponent: -1, IncompleteFunctionComponent: -1, IndeterminateComponent: 4, LazyComponent: -1, LegacyHiddenComponent: -1, MemoComponent: -1, Mode: 10, OffscreenComponent: -1, Profiler: 15, ScopeComponent: -1, SimpleMemoComponent: -1, SuspenseComponent: 16, SuspenseListComponent: -1, Throw: -1, TracingMarkerComponent: -1, ViewTransitionComponent: -1, YieldComponent: -1 }, "16.6.0-beta.0": { ActivityComponent: -1, CacheComponent: -1, ClassComponent: 1, ContextConsumer: 9, ContextProvider: 10, CoroutineComponent: -1, CoroutineHandlerPhase: -1, DehydratedSuspenseComponent: 18, ForwardRef: 11, Fragment: 7, FunctionComponent: 0, HostComponent: 5, HostHoistable: -1, HostPortal: 4, HostRoot: 3, HostSingleton: -1, HostText: 6, IncompleteClassComponent: 17, IncompleteFunctionComponent: -1, IndeterminateComponent: 2, LazyComponent: 16, LegacyHiddenComponent: -1, MemoComponent: 14, Mode: 8, OffscreenComponent: -1, Profiler: 12, ScopeComponent: -1, SimpleMemoComponent: 15, SuspenseComponent: 13, SuspenseListComponent: 19, Throw: -1, TracingMarkerComponent: -1, ViewTransitionComponent: -1, YieldComponent: -1 }, "17.0.0-alpha": { ActivityComponent: -1, CacheComponent: -1, ClassComponent: 1, ContextConsumer: 9, ContextProvider: 10, CoroutineComponent: -1, CoroutineHandlerPhase: -1, DehydratedSuspenseComponent: 18, ForwardRef: 11, Fragment: 7, FunctionComponent: 0, HostComponent: 5, HostHoistable: -1, HostPortal: 4, HostRoot: 3, HostSingleton: -1, HostText: 6, IncompleteClassComponent: 17, IncompleteFunctionComponent: -1, IndeterminateComponent: 2, LazyComponent: 16, LegacyHiddenComponent: 24, MemoComponent: 14, Mode: 8, OffscreenComponent: 23, Profiler: 12, ScopeComponent: 21, SimpleMemoComponent: 15, SuspenseComponent: 13, SuspenseListComponent: 19, Throw: -1, TracingMarkerComponent: -1, ViewTransitionComponent: -1, YieldComponent: -1 }, "17.0.2": { ActivityComponent: 31, CacheComponent: 24, ClassComponent: 1, ContextConsumer: 9, ContextProvider: 10, CoroutineComponent: -1, CoroutineHandlerPhase: -1, DehydratedSuspenseComponent: 18, ForwardRef: 11, Fragment: 7, FunctionComponent: 0, HostComponent: 5, HostHoistable: 26, HostPortal: 4, HostRoot: 3, HostSingleton: 27, HostText: 6, IncompleteClassComponent: 17, IncompleteFunctionComponent: 28, IndeterminateComponent: 2, LazyComponent: 16, LegacyHiddenComponent: 23, MemoComponent: 14, Mode: 8, OffscreenComponent: 22, Profiler: 12, ScopeComponent: 21, SimpleMemoComponent: 15, SuspenseComponent: 13, SuspenseListComponent: 19, Throw: 29, TracingMarkerComponent: 25, ViewTransitionComponent: 30, YieldComponent: -1 } });
  var oe = [{ isMinimumExcluded: true, minimumVersion: `17.0.1`, workTags: m2[`17.0.2`] }, { isMinimumExcluded: false, minimumVersion: `17.0.0-alpha`, workTags: m2[`17.0.0-alpha`] }, { isMinimumExcluded: false, minimumVersion: `16.6.0-beta.0`, workTags: m2[`16.6.0-beta.0`] }, { isMinimumExcluded: false, minimumVersion: `16.4.3-alpha`, workTags: m2[`16.4.3-alpha`] }];
  var h2 = m2[`17.0.2`];
  var g2 = (e2) => {
    if (e2 === void 0) return h2;
    for (let t2 of oe) {
      let n2 = u2(e2, t2.minimumVersion);
      if (n2 === null) return h2;
      if (n2 === 1 || n2 === 0 && !t2.isMinimumExcluded) return t2.workTags;
    }
    return m2[`16.0.0`];
  };
  var _2 = g2();
  var v2 = /* @__PURE__ */ new WeakMap();
  var y2 = (e2) => e2.startsWith(`0.0.0-`) ? _2 : g2(e2);
  var b2 = (e2) => {
    let t2 = e2?.reconcilerVersion;
    return t2 && re(t2) ? y2(t2) : e2?.version ? y2(e2.version) : _2;
  };
  var x = (e2, t2) => {
    let n2 = b2(t2);
    v2.set(e2, n2), e2.alternate && v2.set(e2.alternate, n2);
  };
  var S2 = (e2) => {
    let t2 = v2.get(e2);
    if (t2) return t2;
    let n2 = [e2], r2 = e2;
    for (; r2.return; ) r2 = r2.return, n2.push(r2);
    let i2 = v2.get(r2) ?? _2;
    for (let e3 of n2) v2.set(e3, i2), e3.alternate && v2.set(e3.alternate, i2);
    return i2;
  };
  var se = f2.Placement | f2.Update | f2.ChildDeletion | f2.ContentReset | f2.Hydrating | f2.Visibility | f2.Snapshot;
  var de = (e2) => typeof e2 == `function`;
  var fe = (e2) => {
    let t2 = `displayName` in e2 ? e2.displayName : null;
    if (typeof t2 == `string` && t2) return t2;
    let n2 = `name` in e2 ? e2.name : null;
    return typeof n2 == `string` && n2 ? n2 : null;
  };
  var me = (e2) => {
    let t2 = S2(e2);
    switch (e2.tag) {
      case t2.ClassComponent:
      case t2.ForwardRef:
      case t2.FunctionComponent:
      case t2.MemoComponent:
      case t2.SimpleMemoComponent:
        return true;
      default:
        return false;
    }
  };
  var O2 = (e2) => {
    let t2 = e2.memoizedProps, n2 = e2.alternate?.memoizedProps || {}, r2 = e2.flags ?? e2.effectTag ?? 0, i2 = S2(e2);
    switch (e2.tag) {
      case i2.ClassComponent:
      case i2.ContextConsumer:
      case i2.ForwardRef:
      case i2.FunctionComponent:
      case i2.MemoComponent:
      case i2.SimpleMemoComponent:
        return (r2 & f2.PerformedWork) === f2.PerformedWork;
      default:
        return !e2.alternate || n2 !== t2 || e2.alternate.memoizedState !== e2.memoizedState || e2.alternate.ref !== e2.ref;
    }
  };
  var k2 = (e2) => {
    let t2 = S2(e2);
    switch (e2.tag) {
      case t2.DehydratedSuspenseComponent:
        return true;
      case t2.Fragment:
      case t2.HostText:
      case t2.LegacyHiddenComponent:
      case t2.OffscreenComponent:
        return true;
      case t2.HostRoot:
        return false;
      default: {
        let t3 = typeof e2.type == `object` && e2.type !== null ? e2.type.$$typeof : e2.type;
        if (typeof t3 == `symbol`) return t3.description === p2.CONCURRENT_MODE_SYMBOL_DESCRIPTION || t3.description === p2.DEPRECATED_ASYNC_MODE_SYMBOL_DESCRIPTION;
        switch (t3) {
          case p2.CONCURRENT_MODE_NUMBER:
          case p2.CONCURRENT_MODE_SYMBOL_STRING:
          case p2.DEPRECATED_ASYNC_MODE_SYMBOL_STRING:
            return true;
          default:
            return false;
        }
      }
    }
  };
  var P = (e2) => de(e2) ? e2 : typeof e2 != `object` || !e2 ? null : P(Reflect.get(e2, `type`) ?? Reflect.get(e2, `render`));
  var ge = (e2) => {
    if (typeof e2 == `string`) return e2;
    if (typeof e2 != `function` && typeof e2 != `object` || e2 === null) return null;
    let t2 = fe(e2);
    if (t2) return t2;
    let n2 = P(e2);
    return n2 ? fe(n2) : null;
  };
  var F = /* @__PURE__ */ new Set();
  var I = /* @__PURE__ */ new WeakMap();
  var L = /* @__PURE__ */ new WeakMap();
  var z = 0;
  var B = /* @__PURE__ */ new WeakMap();
  var V = /* @__PURE__ */ new Map();
  var be = typeof FinalizationRegistry == `function` ? new FinalizationRegistry((e2) => {
    V.get(e2)?.deref() || V.delete(e2);
  }) : null;
  var xe = (e2) => typeof WeakRef == `function` ? new WeakRef(e2) : { deref: () => e2 };
  var H = (e2, t2 = z++) => {
    let n2 = B.get(e2);
    n2 !== void 0 && n2 !== t2 && V.delete(n2), B.set(e2, t2), V.set(t2, xe(e2)), be?.register(e2, t2), Number.isSafeInteger(t2) && t2 >= z && (z = t2 + 1);
  };
  var U = (e2) => {
    let t2 = B.get(e2);
    return t2 === void 0 && e2.alternate && (t2 = B.get(e2.alternate), t2 !== void 0 && H(e2, t2)), t2 === void 0 && (t2 = z++, H(e2, t2)), t2;
  };
  var Ce = (e2) => {
    let t2 = e2.alternate ? [e2, e2.alternate] : [e2], n2 = /* @__PURE__ */ new Set();
    for (let e3 of t2) {
      let t3 = B.get(e3);
      t3 !== void 0 && n2.add(t3), B.delete(e3);
    }
    for (let e3 of n2) {
      let n3 = V.get(e3)?.deref();
      (!n3 || t2.includes(n3)) && V.delete(e3);
    }
  };
  var W = (e2, t2, n2) => {
    let r2 = t2;
    for (; r2 !== null; ) {
      if (U(r2), !k2(r2) && O2(r2) && e2(r2, `mount`), r2.tag === S2(r2).SuspenseComponent) {
        if (r2.memoizedState !== null) {
          let t3 = r2.child, n3 = t3 ? t3.sibling : null;
          if (n3) {
            let t4 = n3.child;
            t4 !== null && W(e2, t4, false);
          }
        } else {
          let t3 = r2.child?.child ?? null;
          t3 !== null && W(e2, t3, false);
        }
      } else r2.child !== null && W(e2, r2.child, true);
      r2 = n2 ? r2.sibling : null;
    }
  };
  var G = (e2, t2, n2) => {
    if (U(t2), !n2) return;
    U(n2);
    let r2 = t2.tag === S2(t2).SuspenseComponent;
    !k2(t2) && O2(t2) && e2(t2, `update`);
    let i2 = r2 && n2.memoizedState !== null, a2 = r2 && t2.memoizedState !== null;
    if (i2 && a2) {
      let r3 = t2.child?.sibling ?? null, i3 = n2.child?.sibling ?? null;
      r3 !== null && i3 !== null && G(e2, r3, i3);
    } else if (i2 && !a2) {
      let n3 = t2.child;
      n3 !== null && W(e2, n3, true);
    } else if (!i2 && a2) {
      q(e2, n2);
      let r3 = t2.child?.sibling ?? null;
      r3 !== null && W(e2, r3, true);
    } else if (t2.child !== n2.child) {
      let n3 = t2.child;
      for (; n3; ) n3.alternate ? G(e2, n3, n3.alternate) : W(e2, n3, false), n3 = n3.sibling;
    }
  };
  var K = (e2, t2) => {
    (t2.tag === S2(t2).HostRoot || !k2(t2)) && e2(t2, `unmount`);
  };
  var q = (e2, t2) => {
    let n2 = t2.tag === S2(t2).SuspenseComponent && t2.memoizedState !== null, r2 = t2.child;
    for (n2 && (r2 = (t2.child?.sibling ?? null)?.child ?? null); r2 !== null; ) r2.return !== null && (K(e2, r2), q(e2, r2)), r2 = r2.sibling;
  };
  var J = /* @__PURE__ */ new WeakMap();
  var Y = (e2) => {
    let t2 = e2.memoizedState;
    return t2 != null && t2.element !== null && t2.element !== void 0 && t2.isDehydrated !== true;
  };
  var we = (e2, t2) => {
    let n2 = `current` in e2 ? e2.current : e2, r2 = J.get(e2);
    r2 || (r2 = { prevFiber: null }, J.set(e2, r2));
    let { prevFiber: i2 } = r2;
    if (!n2) i2 && K(t2, i2);
    else if (i2 !== null) {
      let e3 = Y(i2), r3 = Y(n2);
      !e3 && r3 ? W(t2, n2, false) : e3 && r3 ? G(t2, n2, n2.alternate) : e3 && !r3 && K(t2, n2);
    } else W(t2, n2, true);
    r2.prevFiber = n2;
  };
  var X = /* @__PURE__ */ new Set();
  var Z = /* @__PURE__ */ new WeakMap();
  var Q = /* @__PURE__ */ new WeakMap();
  var Te = false;
  var Ee = (e2) => {
    let t2 = Z.get(e2) ?? {};
    if (Z.set(e2, t2), !t2.onCommitFiberRoot || e2.onCommitFiberRoot !== t2.onCommitFiberRoot) {
      let n2 = e2.onCommitFiberRoot, r2 = (t3, i2, a2, o2) => {
        if (n2 && n2.call(e2, t3, i2, a2, o2), Z.get(e2)?.onCommitFiberRoot === r2) {
          x(i2.current, e2.renderers.get(t3)), o(i2) ? (F.delete(i2), I.delete(i2), L.delete(i2)) : (F.add(i2), I.set(i2, t3), L.set(i2, e2));
          for (let { options: n3, target: r3 } of X) r3 === Q.get(e2) && n3.onCommitFiberRoot && n3.onCommitFiberRoot(t3, i2, a2, o2);
        }
      };
      t2.onCommitFiberRoot = r2, e2.onCommitFiberRoot = r2;
    }
    if (!t2.onCommitFiberUnmount || e2.onCommitFiberUnmount !== t2.onCommitFiberUnmount) {
      let n2 = e2.onCommitFiberUnmount, r2 = (t3, i2) => {
        if (x(i2, e2.renderers.get(t3)), n2 && n2.call(e2, t3, i2), Z.get(e2)?.onCommitFiberUnmount === r2) try {
          for (let { options: n3, target: r3 } of X) r3 === Q.get(e2) && n3.onCommitFiberUnmount && n3.onCommitFiberUnmount(t3, i2);
        } finally {
          Ce(i2);
        }
      };
      t2.onCommitFiberUnmount = r2, e2.onCommitFiberUnmount = r2;
    }
    if (!t2.onPostCommitFiberRoot || e2.onPostCommitFiberRoot !== t2.onPostCommitFiberRoot) {
      let n2 = e2.onPostCommitFiberRoot, r2 = (t3, i2) => {
        if (n2 && n2.call(e2, t3, i2), Z.get(e2)?.onPostCommitFiberRoot === r2) for (let { options: n3, target: r3 } of X) r3 === Q.get(e2) && n3.onPostCommitFiberRoot && n3.onPostCommitFiberRoot(t3, i2);
      };
      t2.onPostCommitFiberRoot = r2, e2.onPostCommitFiberRoot = r2;
    }
    if (!t2.onScheduleFiberRoot || e2.onScheduleFiberRoot !== t2.onScheduleFiberRoot) {
      let n2 = e2.onScheduleFiberRoot, r2 = (t3, i2, a2) => {
        if (n2 && n2.call(e2, t3, i2, a2), Z.get(e2)?.onScheduleFiberRoot === r2) for (let { options: n3, target: r3 } of X) r3 === Q.get(e2) && n3.onScheduleFiberRoot && n3.onScheduleFiberRoot(t3, i2, a2);
      };
      t2.onScheduleFiberRoot = r2, e2.onScheduleFiberRoot = r2;
    }
  };
  var De = (e2, t2) => {
    Q.set(e2, t2), Ee(e2);
  };
  var Oe = (e2, t2 = globalThis) => {
    Te ||= (S(De), true), Q.set(e2, t2), Ee(e2);
  };
  try {
    O() && Oe(k());
  } catch {
  }

  // coexist/src/install.js
  var KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
  var state = window.__reactdxCoexist = { order: null, renderersAtInstall: null, commits: 0 };
  function onCommit(root) {
    state.commits++;
    we(root, (fiber) => {
      if (me(fiber)) console.log(`[reactdx:coexist] rendered ${ge(fiber.type)}`);
    });
  }
  function attachTo(hook) {
    const original = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function(id, root, ...rest) {
      const result = original?.call(this, id, root, ...rest);
      onCommit(root);
      return result;
    };
  }
  function createHook() {
    const renderers = /* @__PURE__ */ new Map();
    return {
      renderers,
      supportsFiber: true,
      inject(renderer) {
        const id = renderers.size + 1;
        renderers.set(id, renderer);
        return id;
      },
      onCommitFiberRoot() {
      },
      onCommitFiberUnmount() {
      },
      onPostCommitFiberRoot() {
      },
      checkDCE() {
      }
    };
  }
  function logStatus() {
    const hook = window[KEY];
    const ids = [...hook?.rendererInterfaces?.keys() ?? []];
    const rdtRoots = ids.reduce((sum, id) => sum + hook.getFiberRoots(id).size, 0);
    console.log(
      `[reactdx:coexist] status order=${state.order} rdtAttached=${ids.length > 0} rdtRoots=${rdtRoots} commits=${state.commits}`
    );
  }
  function install() {
    window.addEventListener("load", () => setTimeout(logStatus, 1e3));
    if (Object.hasOwn(window, KEY)) {
      const hook2 = window[KEY];
      state.order = "late";
      state.renderersAtInstall = hook2.renderers?.size ?? 0;
      attachTo(hook2);
      return;
    }
    state.order = "first";
    const hook = createHook();
    attachTo(hook);
    Object.defineProperty(Window.prototype, KEY, { configurable: true, get: () => hook });
    const defineProperty = Object.defineProperty;
    Object.defineProperty = function(target, key, descriptor) {
      const result = defineProperty(target, key, descriptor);
      if (target === window && key === KEY) attachTo(window[KEY]);
      return result;
    };
  }

  // coexist/src/late.js
  var tries = 0;
  var waitForRdt = () => {
    if (Object.hasOwn(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__") || ++tries > 200) install();
    else setTimeout(waitForRdt, 10);
  };
  waitForRdt();
})();
/*! Bundled license information:

bippy/dist/rdt-hook.js:
bippy/dist/core.js:
  (**
   * @license bippy
   *
   * Copyright (c) Aiden Bai
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
