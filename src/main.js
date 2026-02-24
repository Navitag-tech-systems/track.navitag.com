import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { auth } from './firebase'; 
import ky from 'ky';

import { useUserStore } from './stores/user.js';
import router from './router'; // Import the router
import './style.css'; 
import App from './App.vue';
import { App as CapacitorApp } from '@capacitor/app'; // Import Capacitor App plugin
import '@fortawesome/fontawesome-free/css/all.css'; // <--- Add this line

import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

import { Network } from '@capacitor/network';


const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router); // Use the router

const userStore = useUserStore(pinia);

// Handle Deep Links (Password Resets / Email Verifications)
CapacitorApp.addListener('appUrlOpen', (data) => {
  // Extract the path from the URL (e.g., https://track.navitag.com/auth/action?mode=...)
  const url = new URL(data.url);
  
  // If it's the auth action route, push to router
  if (url.pathname === '/auth/action') {
    router.push({ path: '/auth/action', query: Object.fromEntries(url.searchParams) });
  }
});

// listerner for network changes
Network.addListener('networkStatusChange', status => { console.log('Network status changed', status) });

// Handle Deep Links (Password Resets / Email Verifications)
CapacitorApp.addListener('appUrlOpen', (data) => {
  // Extract the path from the URL (e.g., https://track.navitag.com/auth/action?mode=...)
  const url = new URL(data.url);
  
  // If it's the auth action route, push to router
  if (url.pathname === '/auth/action') {
    router.push({ path: '/auth/action', query: Object.fromEntries(url.searchParams) });
  }
});

const CountryCode = await CountryCodeByIp()
userStore.countryCode = CountryCode

// Firebase Auth Listerner
auth.addListener('authStateChange', async (data) => {
  const firebaseUser = data.user;
  if (firebaseUser) {
    userStore.setUser(firebaseUser);
    if(!firebaseUser.emailVerified){
      //send email verification
    }    
    router.replace('/');
  } else {
    userStore.clearUser();
    if (router.currentRoute.value.meta.requiresAuth) {
      router.replace('/login');
    }
  }
});

//helper function to get country code
async function CountryCodeByIp() {
  const token = 'f1b39e92820d53';
  try {
    // Step 1: Get the current public IP address
    const ipData = await ky.get('https://api.ipify.org?format=json').json();
    const userIp = ipData.ip;

    // Step 2: Use that IP to get the country code from IPinfo
    const url = `https://api.ipinfo.io/lite/${userIp}?token=${token}`;
    const countryData = await ky.get(url).json();
    
    return countryData.country_code; // Returns 'US', 'GB', 'PH', etc.
  } catch (error) {
    console.error('Failed to retrieve location data:', error);
    return null;
  }
}

app.mount('#app');