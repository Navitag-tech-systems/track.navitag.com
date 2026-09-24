import { useUserStore } from '@/stores/user';
import { useDevicesStore } from '@/stores/devices';
import { useNotificationsStore } from '@/stores/notifications';
import { useBrokerStore } from '@/stores/broker';
import { useBootStore } from '@/stores/boot';
import { request } from '@/utils/http';
import { baseUrl } from '@/utils/variables';
import router from '@/router';

// Result codes shared by startSession / checkConnectionAndReconnect so the
// overlay Reconnect button can tell "not a failure" apart from "failed":
//   'ok'         connected and live
//   'no_devices' connected; the account has nothing to show (teaser shown)
//   'failed'     a step failed; userStore.error is set
//   'offline'    userStore.internet is false; nothing was attempted
//   'busy'       another run holds the lock; nothing was attempted
export const session = {
  reconnectTimer: null,
  isReconnecting: false,
  isStartingSession: false,
  countryCodePromise: null,
  // Last connectivity we acted on. Shared between the network listener and the
  // resume handler so a status re-read on foreground does not leave the
  // listener believing we are still offline (which would make the next repeated
  // `connected:true` event look like a transition).
  wasOnline: null,

  async startSession() {
    if (this.isStartingSession) return 'busy';
    this.isStartingSession = true;

    const userStore = useUserStore();
    const deviceStore = useDevicesStore();
    const boot = useBootStore();

    // Restart as a cold boot only if a warm reconnect ran in between. On the
    // ordinary first boot this is a no-op — init() already opened the cold flow
    // and the auth/region steps are underway, so the bar must not rewind.
    boot.ensureFlow('cold');
    // Idempotent: covers a log-out → log-in without a page reload, where the
    // auth listener's done('auth') landed against a previous run.
    boot.done('auth');

    try {
      if (this.countryCodePromise) {
        boot.begin('region');
        await this.countryCodePromise;
      }
      boot.done('region', { degraded: userStore.countryCode == null });

      boot.begin('account');
      const synced = await userStore.backendSync();
      if (!synced) {
        console.warn('⚠️ Backend Sync Failed — retrying with fresh token...');
        const freshToken = await userStore.getFreshToken();
        const retried = freshToken ? await userStore.backendSync(freshToken) : false;
        if (!retried) {
          console.error('❌ Backend Sync Failed after retry');
          boot.fail('account');
          userStore.error = true;
          return 'failed';
        }
      }
      boot.done('account');

      boot.begin('server');
      const connected = await userStore.serverConnect();
      if (!connected) {
        console.error('❌ Server Connect Failed');
        boot.fail('server');
        userStore.error = true;
        return 'failed';
      }
      boot.done('server');

      // The devices + live steps are marked inside fetchAll / processSocketData,
      // so all three fetchAll callers get them without duplicating the calls.
      const fetched = await deviceStore.fetchAll();

      if (fetched === 'no_devices') {
        return 'no_devices';
      }

      if (!fetched) {
        console.error('❌ Failed to fetch devices or geofences');
        userStore.error = true;
        return 'failed';
      }

      await userStore.connectSocket(
        deviceStore.processSocketData,
        () => this.handleSocketDisconnect()
      );
      if (!userStore.socket) return 'failed';

      // Broker carries live positions for shared-to-me devices. Connect
      // after fetchAll so the mergeSharedToMeIntoDevices step has already
      // placed the device rows (with shared:true + scopes) — a PUBLISH that
      // arrives before the row exists would create a scope-less ghost in
      // processSocketData's "create new device" branch.
      useBrokerStore().connect();

      // The geofence quota is enforced entirely server-side now: creation is
      // refused at the limit by POST /v1/geofence, and pruning runs from the
      // plan/expiration events that actually change an allowance. Deleting a
      // user's data as a side effect of opening the app is gone.

      return 'ok';
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
    await request.clearSession();
    userStore.clearUser();
    deviceStore.clearData();
    useNotificationsStore().reset();
    this.isReconnecting = false;
    this.isStartingSession = false;
    console.log('logout');
    router.replace('/login');
  },

  async checkConnectionAndReconnect() {
    if (this.isReconnecting) return 'busy';
    // startSession holds a DIFFERENT lock (isStartingSession), so the two could
    // previously overlap: backgrounding and foregrounding during a cold boot
    // sees a not-yet-open socket, fires a reconnect, and we end up running two
    // fetchAll + connectSocket sequences against each other. A session that is
    // still starting is already doing everything this would do.
    if (this.isStartingSession) {
      console.log('⏸️ Skipping reconnect — session start already in progress.');
      return 'busy';
    }

    const userStore = useUserStore();
    if (!userStore.server_url) return 'failed';
    // Don't even try while offline — serverConnect would just fail and
    // set userStore.error, which (since the user is looking at <NoNet />)
    // would surface <Error /> the moment network came back.
    if (!userStore.internet) return 'offline';

    this.isReconnecting = true;
    const deviceStore = useDevicesStore();
    const boot = useBootStore();

    // A reconnect resumes from the Traccar session — auth restore and
    // /user/sync do not re-run — so it gets the shorter warm flow, normalized
    // to reach 100%. Always a fresh run, unlike startSession's ensureFlow.
    //
    // Reset unless a run is already animating: a reconnect CONTINUES that run,
    // it does not start a new one — resetting mid-run rewinds the bar and
    // breaks the "never goes backwards" guarantee in boot.js's docblock.
    //
    // This used to ALSO skip the reset once the user was in the app, because
    // reset() clears `stalled` and the cold splash came back over a working
    // UI. The cold splash is now latched off by App.vue's hasRenderedOnce, so
    // an in-app reconnect shows the thin warm bar instead — which is the only
    // feedback it has, since the warm path below never raises `loading`.
    // Without the reset every step is already 'done', the run is `complete`,
    // and the bar never appears.
    if (!boot.inProgress) boot.reset('warm');

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Warm = the user already has data on screen. The socket opens BEFORE the
    // refetch so positions start moving as soon as the Traccar session is
    // confirmed, instead of after three more round trips; fetchDevices merges
    // rows, so a frame that lands mid-fetch survives it.
    const warm = deviceStore.hasLoadedOnce;

    try {
      boot.begin('server');
      const sessionValid = await userStore.serverConnect();

      if (!sessionValid) {
        boot.fail('server');
        userStore.error = true;
        return 'failed';
      }
      boot.done('server');

      if (warm) {
        await userStore.connectSocket(
          deviceStore.processSocketData,
          () => this.handleSocketDisconnect()
        );
        if (!userStore.socket) return 'failed';
      }

      const fetched = await deviceStore.fetchAll({ warm });

      // fetchAll already redirected to the teaser; don't keep sockets open
      // for a zero-device account (and don't flag it as an error).
      if (fetched === 'no_devices') {
        if (warm) userStore.disconnectSocket();
        return 'no_devices';
      }

      if (!fetched) {
        console.error('❌ Failed to fetch devices or geofences');
        userStore.error = true;
        return 'failed';
      }

      if (!warm) {
        await userStore.connectSocket(
          deviceStore.processSocketData,
          () => this.handleSocketDisconnect()
        );
        if (!userStore.socket) return 'failed';
      }

      const broker = useBrokerStore();
      broker.disconnect();
      broker.connect();
      return 'ok';
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
    const boot = useBootStore();

    console.log('🔄 Initiating manual data reload and socket cycle...');

    // Warm flow: this path never re-runs auth or /user/sync. The Traccar
    // session is assumed live, so the server step is already behind us.
    boot.reset('warm');
    boot.done('server');

    try {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

      if (userStore.socket) {
        console.log('🔌 Disconnecting current socket...');
        userStore.disconnectSocket();
      }
      useBrokerStore().disconnect();

      console.log('📥 Fetching latest devices and geofences...');
      const fetched = await deviceStore.fetchAll();

      // fetchAll already redirected to the teaser; don't reconnect sockets
      // for a zero-device account (and don't flag it as an error).
      if (fetched === 'no_devices') {
        return;
      }

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
