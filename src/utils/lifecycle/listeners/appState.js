import { App } from '@capacitor/app';
import { useUserStore } from '@/stores/user';
import { useBrokerStore } from '@/stores/broker';

export function registerAppStateListener(session) {
  App.addListener('appStateChange', async ({ isActive }) => {
    console.log(`📱 App State Changed: ${isActive ? 'Active' : 'Background'}`);

    if (!isActive) {
      // Policy: keep WS / broker connections alive as long as the
      // platform allows. If the OS or browser kills them while we're
      // backgrounded, we self-heal on the next foreground rather than
      // proactively tearing things down here.
      return;
    }

    const userStore = useUserStore();
    if (!userStore.isLoggedIn) return;

    // Clear any stale error left over from a background-failed reconnect
    // attempt (handleSocketDisconnect / broker._scheduleReconnect can
    // race with page suspension under heavy throttling). Without this,
    // the user can see <Error /> the moment the app foregrounds even
    // though the heal is about to run.
    userStore.error = false;

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
