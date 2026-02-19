import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { baseUrl } from '@/utils/variables';

export const useUserStore = defineStore('user', () => {
  // State
  const user = ref(null);
  const idToken = ref(null);
  const fcmToken = ref(null);
  const countryCode = ref(null)
  const name = ref(null)
  const phone = ref(null)
  const server_url = ref(null)
  const server_token = ref(null)
  const server_connect = ref(false)

  // Getters (Computed properties)
  const isLoggedIn = computed(() => user.value !== null);

  const loading = computed(() => {
    if(user.value === null){
      // initail state
      return true
    } else if(user.value === false){ 
      //user signed out
      if(countryCode.value !== null){
        return true
      } else {
        return false
      } 
    } else {
      //user signed in. wait to connect to server retunr sever_connect value that defaults to false
      return server_connect.value
    }
  });



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
    if  (firebaseUser){
      initPushNotifications(); // Init push on login
      backendSync()
    } 

  }

  function setToken(token) {
    idToken.value = token;
  }

  function clearUser() {
    user.value = null;
    idToken.value = null;
  }

  async function backendSync() {
    const data = {'county_code' : countryCode.value}
    if(name.value !== null  &&  name.value !== '') {
      data.name = name.value
    }

    if(phone.value !== null  &&  phone.value !== '') {
      data.phone = phone.value
    }

    const syncRes = await ky.post(baseUrl + "/user/sync", data).json();
    if(syncRes.name !== null && syncRes.name !== ''){
      name.value = syncRes.name
    }

    if(syncRes.phone !== null && syncRes.phone !== ''){
      phone.value = syncRes.phone
    }

    server_url.value = syncRes.server_url !== null && syncRes.server_url !== '' && syncRes.server_url !== false ? syncRes.server_url : false
    server_token.value = syncRes.server_token !== null && syncRes.server_token !== '' && syncRes.server_token !== false ? syncRes.server_token : false
  }

  return { user, idToken, countryCode, loading, isLoggedIn, setUser, setToken, clearUser};
});