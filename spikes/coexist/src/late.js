import { install } from './install.js';

// Test-only: defer so RDT's document_start hook is installed before ours.
setTimeout(install, 0);
