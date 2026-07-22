import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user';
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
      iapLogIn(firebaseUser.uid);

      const sessionStarted = await session.startSession();
      if (sessionStarted) {
        router.replace('/');
      }
    } else {
      console.log('🛑 Auth State: Logged Out');
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
