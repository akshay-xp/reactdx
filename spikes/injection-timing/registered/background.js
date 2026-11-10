chrome.runtime.onInstalled.addListener(() => {
  chrome.scripting.registerContentScripts([
    {
      id: 'reactdx-timing',
      js: ['hook.js'],
      matches: ['http://localhost/*', 'http://127.0.0.1/*'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: true,
    },
  ]);
});
