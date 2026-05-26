import { Network } from '@capacitor/network';
import { useUserStore } from '@/stores/user';

export function registerNetworkListener(session) {
  const userStore = useUserStore();

  Network.getStatus().then(status => {
    userStore.internet = status.connected;
  });

  Network.addListener('networkStatusChange', async (status) => {
    console.log(`📡 Network Status: ${status.connected ? 'Online' : 'Offline'}`);
    userStore.internet = status.connected;

    if (status.connected && userStore.isLoggedIn) {
      // Clear any error left over from a failed reconnect attempt that
      // ran while we were briefly offline — otherwise <NoNet /> hides on
      // recovery but <Error /> takes its place because userStore.error
      // was never reset.
      userStore.error = false;
      await session.checkConnectionAndReconnect();
    }
  });
}
