import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';
import { useNotificationsStore } from '@/stores/notifications';
import { useBrokerStore } from '@/stores/broker';
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

      // Broker carries live positions for shared-to-me devices. Connect
      // after fetchAll so the mergeSharedToMeIntoDevices step has already
      // placed the device rows (with shared:true + scopes) — a PUBLISH that
      // arrives before the row exists would create a scope-less ghost in
      // processSocketData's "create new device" branch.
      useBrokerStore().connect();

      deviceStore.enforceGeofenceLimit();

      return true;
    } finally {
      this.isStartingSession = false;
    }
  },

  async stopSession() {
    const userStore = useUserStore();
    const deviceStore = useDevicesStore();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    userStore.disconnectSocket();
    useBrokerStore().disconnect();

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
    // Don't even try while offline — serverConnect would just fail and
    // set userStore.error, which (since the user is looking at <NoNet />)
    // would surface <Error /> the moment network came back.
    if (!userStore.internet) return;

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

        const broker = useBrokerStore();
        broker.disconnect();
        broker.connect();

        deviceStore.enforceGeofenceLimit();
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
      useBrokerStore().disconnect();

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
      useBrokerStore().connect();

      deviceStore.enforceGeofenceLimit();

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

    console.log('🔄 Socket dropped. Attempting to reconnect in 500ms...');

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(async () => {
      // Re-check on fire: airplane mode ON can race so that the WS close
      // event reaches us *before* networkStatusChange flips
      // userStore.internet to false. The entry gate above sees online,
      // queues this timer, and we'd otherwise try (and fail) a
      // reconnect while still offline — setting userStore.error and
      // making <Error /> show up the moment network returned.
      const u = useUserStore();
      if (!u.isLoggedIn || !u.internet) {
        console.log('⏸️ Skipping queued reconnect — offline or logged out.');
        return;
      }
      // Skip while the page is hidden — fetch + WS work are throttled in
      // suspended tabs, and a failure here would set userStore.error true,
      // flashing <Error /> the moment the app foregrounds. The
      // appStateChange foreground handler self-heals on resume.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        console.log('⏸️ Skipping queued reconnect — page hidden, foreground will self-heal.');
        return;
      }
      console.log('🔄 Firing auto-reconnect sequence...');
      await this.checkConnectionAndReconnect();
    }, 500);
  }
};
