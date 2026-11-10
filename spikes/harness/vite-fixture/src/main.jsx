import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(<App />);

if (new URLSearchParams(location.search).has('sequence') || sessionStorage.getItem('reactdxSequence')) {
  import('./sequence.js');
}
