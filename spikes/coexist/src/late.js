import { install } from './install.js';

// Test-only: wait until RDT's hook is on window so ours installs second. A single setTimeout(0)
// is enough in Chrome, but in Firefox RDT's hook script runs later than that.
let tries = 0;
const waitForRdt = () => {
  if (Object.hasOwn(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__') || ++tries > 200) install();
  else setTimeout(waitForRdt, 10);
};
waitForRdt();
