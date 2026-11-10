// Firefox-only: web-ext can't drive the page, so the page walks through the timing scenarios itself.
// The timing hook logs a status line 500 ms after each pageshow.
const log = (step) => console.log(`[reactdx:timing] step=${step}`);
const next = (step) => sessionStorage.setItem('reactdxSequence', step);

const step = sessionStorage.getItem('reactdxSequence') ?? 'normal-load';
log(step);

if (step === 'normal-load') {
  next('hard-reload');
  setTimeout(() => location.reload(true), 1500);
} else if (step === 'hard-reload') {
  next('back');
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    log('bfcache-restore');
    sessionStorage.removeItem('reactdxSequence');
    document.querySelector('[data-testid="counter"]').click();
  });
  setTimeout(() => (location.href = '/other.html?back'), 1500);
} else {
  log('back-without-bfcache');
  sessionStorage.removeItem('reactdxSequence');
}
