import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router'; 
import './style.css'; 
import App from './App.vue';
import '@fortawesome/fontawesome-free/css/all.css'; 
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

// Import the new Service
import { LifecycleService } from '@/utils/lifecycle';
import { registerPwa } from '@/utils/pwa';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// Initialize the Centralized Lifecycle Manager
// This sets up Auth, Network, and App State listeners
LifecycleService.init();

// Register the PWA service worker on web (no-op on native).
registerPwa();


app.mount('#app');

// Debug console (eruda) + on-device connectivity diagnostics. Enabled ONLY
// when built with VITE_DEBUG_CONSOLE=true (e.g. a Codemagic debug build); the
// dynamic imports are tree-shaken out of normal release builds. Once running,
// open the eruda panel and call window.netcheck() from its console to test
// whether the navitag.* WKAppBoundDomains entries can be removed/wildcarded
// and why tiles fail on iOS. See src/utils/debug/netcheck.js.
if (import.meta.env.VITE_DEBUG_CONSOLE === 'true') {
  import('eruda').then(async ({ default: eruda }) => {
    eruda.init();
    const { runNetCheck } = await import('@/utils/debug/netcheck');
    window.netcheck = runNetCheck;
    setTimeout(() => runNetCheck(), 4000);
  });
}