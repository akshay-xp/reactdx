import { instrument } from 'bippy';

instrument({
  onActive() {
    console.log('[reactdx:bippy] active');
  },
});
