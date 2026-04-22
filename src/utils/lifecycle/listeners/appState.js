import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useUserStore } from '@/stores/user';

export function registerAppStateListener(session) {
  App.addListener('appStateChange', async ({ isActive }) => {
    console.log(`📱 App State Changed: ${isActive ? 'Active' : 'Background'}`);

    if (!Capacitor.isNativePlatform()) return;

    const userStore = useUserStore();

    if (isActive) {
      if (userStore.isLoggedIn) {
        await session.checkConnectionAndReconnect();
      }
    } else {
      if (userStore.socket) {
        console.log('⏸️ Pausing: Closing WebSocket');
        userStore.disconnectSocket();
      }
    }
  });
}
