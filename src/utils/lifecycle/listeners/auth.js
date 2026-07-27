import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user';
import { useBootStore } from '@/stores/boot';
import router from '@/router';
import { iapLogIn, iapLogOut } from '@/utils/iap';
import { clearMedusaSession } from '@/utils/medusa';

export function registerAuthListeners(session) {
  auth.addListener('authStateChange', async (data) => {
    const userStore = useUserStore();
    const firebaseUser = data.user;

    if (firebaseUser) {
      console.log('✅ Auth State: Logged In');

      await userStore.setUser(firebaseUser);
      useBootStore().done('auth');
      iapLogIn(firebaseUser.uid);

      const sessionStarted = await session.startSession();
      if (sessionStarted) {
        router.replace('/');
      }
    } else {
      console.log('🛑 Auth State: Logged Out');
      // Stand the boot run down. init() opened it with auth + region in flight,
      // and nothing on the logged-out path ever closes those — leaving the
      // progress store's rAF loop running for as long as the user sits on the
      // login screen. A later login re-opens the run from startSession.
      useBootStore().reset('cold');
      iapLogOut();
      clearMedusaSession();
      if (userStore.isLoggedIn) {
        session.stopSession();
      } else {
        userStore.traccarLogout().catch(() => {});
        userStore.clearUser();
        if (router.currentRoute.value.meta.requiresAuth) {
          router.replace('/login');
        }
      }
    }
  });

  auth.addListener('idTokenChange', async (data) => {
    if (data.user) {
      const userStore = useUserStore();
      const result = await auth.getIdToken();
      userStore.idToken = result.token;
      console.log('🔑 ID Token refreshed');
    }
  });
}
