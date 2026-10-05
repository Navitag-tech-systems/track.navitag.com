import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { useUserStore } from '@/stores/user';
import { useBrokerStore } from '@/stores/broker';
import { useUserLocationStore } from '@/stores/userLocation';

export function registerAppStateListener(session) {
  App.addListener('appStateChange', async ({ isActive }) => {
    console.log(`📱 App State Changed: ${isActive ? 'Active' : 'Background'}`);

    if (!isActive) {
      // Location is the one exception to the keep-it-alive policy below: the
      // permission is when-in-use, so the watch is dropped the moment we are
      // not in use and re-armed on the way back. See userLocation.suspend().
      useUserLocationStore().suspend();

      // Policy: keep WS / broker connections alive as long as the
      // platform allows. If the OS or browser kills them while we're
      // backgrounded, we self-heal on the next foreground rather than
      // proactively tearing things down here.
      return;
    }

    const userStore = useUserStore();
    if (!userStore.isLoggedIn) return;

    // Re-arm the location watch before the connection work below: it is
    // independent of the socket and should not wait on a reconnect.
    useUserLocationStore().resumeFromBackground();

    // Clear any stale error left over from a background-failed reconnect
    // attempt (handleSocketDisconnect / broker._scheduleReconnect can
    // race with page suspension under heavy throttling). Without this,
    // the user can see <Error /> the moment the app foregrounds even
    // though the heal is about to run.
    userStore.error = false;

    // Re-read connectivity. `userStore.internet` is otherwise fed only by
    // networkStatusChange events, and one missed while backgrounded (Wi-Fi ↔
    // mobile, a drop that recovered) is lost: the app resumed OFFLINE with the
    // phone online, and every reconnect path bailed on `!internet`. Upgrade
    // only — a `connected:false` here is left to the listener, which also
    // drives the teardown side.
    try {
      const status = await Network.getStatus();
      if (status.connected) {
        session.wasOnline = true;
        if (!userStore.internet) {
          console.log('📡 Network re-read on resume: online (event was missed)');
          userStore.internet = true;
        }
      }
    } catch (err) {
      console.warn('Network.getStatus failed on resume:', err?.message || err);
    }

    // Only cycle the session if a connection actually broke while we
    // were away — a healthy WS + broker should be left alone so the
    // common foreground-resume case is instant.
    const ws = userStore.socket;
    const wsHealthy = !!ws && ws.readyState === WebSocket.OPEN;
    const brokerHealthy = useBrokerStore().connected;

    if (!wsHealthy || !brokerHealthy) {
      console.log(`🔄 Self-heal on foreground (ws=${wsHealthy} broker=${brokerHealthy})`);
      await session.checkConnectionAndReconnect();
    }
  });
}
