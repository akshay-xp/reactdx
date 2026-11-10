const { inspectedWindow, network } = chrome.devtools;

// No host permissions: the only way to get the hook in before React is a reload with the
// hook injected ahead of the page's own scripts. That has to happen again after every full navigation.
let ownReload = false;

function connect() {
  // eval right after our own reload can run before the new document is ready and report no hook,
  // which would reload in a loop, so the navigation we caused is skipped.
  if (ownReload) {
    ownReload = false;
    return;
  }
  inspectedWindow.eval('!!window.__reactdxTiming', async (hasHook) => {
    if (hasHook) return;
    const source = await (await fetch(chrome.runtime.getURL('hook.js'))).text();
    ownReload = true;
    inspectedWindow.reload({ injectedScript: source });
  });
}

connect();
network.onNavigated.addListener(connect);
