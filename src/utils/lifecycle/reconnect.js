import { Network } from '@capacitor/network';
import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';
import { session } from './session';

/**
 * The overlay Reconnect button (<NoNet /> and <Error />).
 *
 * Returns one of session's result codes: 'ok' | 'no_devices' | 'failed' |
 * 'offline' | 'busy'. Never throws.
 *
 *  - Re-reads the network status first, so a stale `internet === false` left
 *    by a missed networkStatusChange event cannot block the attempt, and a
 *    tap while genuinely offline reports 'offline' without touching the
 *    server (which would set userStore.error and swap OFFLINE for Error).
 *  - Cold start when the app never finished loading or has no Traccar session
 *    to resume (the common <Error /> case is a failed /user/sync, where
 *    server_url was never set and checkConnectionAndReconnect is a no-op).
 *    Warm reconnect otherwise.
 */
export async function reconnectFromOverlay() {
  const userStore = useUserStore();
  const deviceStore = useDevicesStore();

  let connected = true;
  try {
    connected = (await Network.getStatus()).connected;
  } catch (err) {
    console.warn('Network.getStatus failed on Reconnect:', err?.message || err);
  }
  session.wasOnline = connected;
  userStore.internet = connected;
  if (!connected) return 'offline';

  userStore.error = false;

  const cold = !deviceStore.hasLoadedOnce || !userStore.server_url;
  try {
    return cold
      ? await session.startSession()
      : await session.checkConnectionAndReconnect();
  } catch (err) {
    console.error('Reconnect threw:', err);
    userStore.error = true;
    return 'failed';
  }
}
