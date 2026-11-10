import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(<App />);

if (new URLSearchParams(location.search).has('sequence') || sessionStorage.getItem('reactdxSequence')) {
  import('./sequence.js');
}

// Firefox-only (#6): web-ext can't navigate the page, so ?go=<port> makes a full navigation.
const go = new URLSearchParams(location.search).get('go');
if (go) setTimeout(() => (location.href = `http://localhost:${go}/`), 2000);
