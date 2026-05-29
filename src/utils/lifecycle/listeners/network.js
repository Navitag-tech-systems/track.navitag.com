import { Network } from '@capacitor/network';
import { useUserStore } from '@/stores/user';
import { useBrokerStore } from '@/stores/broker';

export function registerNetworkListener(session) {
  const userStore = useUserStore();

  // Track connectivity ourselves so we only react to a real state change.
  // networkStatusChange is NOT edge-triggered on native: Android fires it on
  // every NetworkCapabilities change (validation, signal, metered…), so
  // connected:true repeats constantly (worse on aggressive OEMs like ColorOS).
  // Without this guard, each repeat rebuilds the whole Traccar session + WS.
  let wasOnline = null;

  Network.getStatus().then(status => {
    userStore.internet = status.connected;
    if (wasOnline === null) wasOnline = status.connected;
  });

  Network.addListener('networkStatusChange', async (status) => {
    const nowOnline = status.connected;
    const stateChanged = nowOnline !== wasOnline;
    wasOnline = nowOnline;
    userStore.internet = nowOnline;

    // Ignore the repeated "still online" events that drive the churn — only
    // a genuine offline↔online transition is worth acting on here.
    if (!stateChanged) return;

    console.log(`📡 Network Status: ${nowOnline ? 'Online' : 'Offline'}`);

    if (!nowOnline || !userStore.isLoggedIn) return;

    // Clear any error left over from a failed reconnect attempt that ran
    // while we were briefly offline — otherwise <NoNet /> hides on recovery
    // but <Error /> takes its place because userStore.error was never reset.
    userStore.error = false;

    // Health guard (outcome-based, platform-agnostic): if the socket and
    // broker are already up, a brief blip that didn't actually drop them
    // shouldn't trigger a needless teardown. WebSocket.readyState is a web
    // standard available on every platform (native WebView, iOS, web/PWA).
    const wsHealthy = userStore.socket?.readyState === WebSocket.OPEN;
    if (wsHealthy && useBrokerStore().connected) return;

    await session.checkConnectionAndReconnect();
  });
}
