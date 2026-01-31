import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref(null);
  const idToken = ref(null);
  const loading = ref(true); // "Is Firebase checking the disk?"
  const fcmToken = ref(null);

  // Getters (Computed properties)
  const isLoggedIn = computed(() => user.value !== null);

  async function initPushNotifications() {
    // 1. Request permissions
    const status = await FirebaseMessaging.requestPermissions();
    
    if (status.receive === 'granted') {
      // 2. Get device token
      const result = await FirebaseMessaging.getToken({
        vapidKey: 'BNfYDc6R8T-d0Mbmv8Idhmu0Ufl5zqiK9GSty0XNKDkp38ETHDV74t2BwmjiEd4aN-GYobZbLq-r_I_ga25a--Q', // <-- Paste your key here
      });
      fcmToken.value = result.token;
      
      // 3. Listen for foreground notifications
      FirebaseMessaging.addListener('notificationReceived', (event) => {
        console.log('Notification:', event.notification);
      });
    }
  }

  // Actions
  function setUser(firebaseUser) {
    user.value = firebaseUser;
    if (firebaseUser) initPushNotifications(); // Init push on login
    loading.value = false;
  }

  function setToken(token) {
    idToken.value = token;
  }

  function clearUser() {
    user.value = null;
    idToken.value = null;
    loading.value = false;
  }

  return { user, idToken, loading, isLoggedIn, setUser, setToken, clearUser};
});