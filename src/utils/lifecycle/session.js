import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';
import { useNotificationsStore } from '@/stores/notifications';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';
import router from '@/router';

export const session = {
  reconnectTimer: null,
  isReconnecting: false,
  isStartingSession: false,
  countryCodePromise: null,

  async startSession() {
    if (this.isStartingSession) return false;
    this.isStartingSession = true;

    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    try {
      if (this.countryCodePromise) {
        await this.countryCodePromise;
      }

      const synced = await userStore.backendSync();
      if (!synced) {
        console.warn('⚠️ Backend Sync Failed — retrying with fresh token...');
        const freshToken = await userStore.getFreshToken();
        const retried = freshToken ? await userStore.backendSync(freshToken) : false;
        if (!retried) {
          console.error('❌ Backend Sync Failed after retry');
          userStore.error = true;
          return false;
        }
      }

      const connected = await userStore.serverConnect();
      if (!connected) {
        console.error('❌ Server Connect Failed');
        userStore.error = true;
        return false;
      }

      const fetched = await deviceStore.fetchAll();

      if (fetched === 'no_devices') {
        return false;
      }

      if (!fetched) {
        console.error('❌ Failed to fetch devices or geofences');
        userStore.error = true;
        return false;
      }

      userStore.connectSocket(
        deviceStore.processSocketData,
        () => this.handleSocketDisconnect()
      );

      deviceStore.enforceGeofenceLimit();

      this.fetchUserNotifications();

      return true;
    } finally {
      this.isStartingSession = false;
    }
  },

  fetchUserNotifications() {
    const userStore = useUserStore();
    if (!userStore.server_url) return;
    request.send({
      url: `https://${userStore.server_url}/api/notifications`,
      method: 'GET',
      isTraccar: true,
    })
      .then(res => {
        const list = Array.isArray(res) ? res : [];
        userStore.notifications = list;
        console.log('🔔 Notifications loaded:', list.length);
      })
      .catch(err => console.warn('⚠️ Notifications fetch failed:', err?.message || err));
  },

  async stopSession() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    userStore.disconnectSocket();

    try {
      await request.send({
        url: `${baseUrl}/user/logout`,
        method: 'POST',
        token: userStore.idToken,
      });
    } catch (err) {
      console.warn('⚠️ Backend logout failed:', err?.message || err);
    }

    await userStore.traccarLogout();
    userStore.clearUser();
    deviceStore.clearData();
    useNotificationsStore().reset();
    this.isReconnecting = false;
    this.isStartingSession = false;
    console.log('logout');
    router.replace('/login');
  },

  async checkConnectionAndReconnect() {
    if (this.isReconnecting) return;

    const userStore = useUserStore();
    if (!userStore.server_url) return;

    this.isReconnecting = true;
    const deviceStore = useDevicesStore();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    try {
      const sessionValid = await userStore.serverConnect();

      if (sessionValid) {
        const fetched = await deviceStore.fetchAll();

        if (!fetched) {
          console.error('❌ Failed to fetch devices or geofences');
          userStore.error = true;
          return;
        }

        userStore.connectSocket(
          deviceStore.processSocketData,
          () => this.handleSocketDisconnect()
        );

        deviceStore.enforceGeofenceLimit();

        this.fetchUserNotifications();
      } else {
        userStore.error = true;
      }
    } finally {
      this.isReconnecting = false;
    }
  },

  async reloadAndReconnect() {
    if (this.isReconnecting) {
      console.warn('⚠️ Reconnect already in progress. Ignoring manual reload.');
      return;
    }
    this.isReconnecting = true;

    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    console.log('🔄 Initiating manual data reload and socket cycle...');

    try {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

      if (userStore.socket) {
        console.log('🔌 Disconnecting current socket...');
        userStore.disconnectSocket();
      }

      console.log('📥 Fetching latest devices and geofences...');
      const fetched = await deviceStore.fetchAll();

      if (!fetched) {
        console.error('❌ Failed to fetch devices or geofences');
        userStore.error = true;
        return;
      }

      console.log('🔌 Reconnecting socket...');
      userStore.connectSocket(
        deviceStore.processSocketData,
        () => this.handleSocketDisconnect()
      );

      deviceStore.enforceGeofenceLimit();

      this.fetchUserNotifications();

      console.log('✅ Data reloaded and socket reconnected successfully!');
    } catch (error) {
      console.error('❌ Error during reload and reconnect sequence:', error);
      userStore.error = true;
    } finally {
      this.isReconnecting = false;
    }
  },

  handleSocketDisconnect() {
    const userStore = useUserStore();

    if (!userStore.isLoggedIn || !userStore.internet) return;

    console.log('🔄 Socket dropped. Attempting to reconnect in 5 seconds...');

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(async () => {
      console.log('🔄 Firing auto-reconnect sequence...');
      await this.checkConnectionAndReconnect();
    }, 5000);
  }
};
