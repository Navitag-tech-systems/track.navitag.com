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
      await session.checkConnectionAndReconnect();
    }
  });
}
