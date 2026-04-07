<script setup>
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

// Added 'tab' which will match against route.meta.activeTab
const navItems = [
  { name: 'Items', icon: 'fa-solid fa-list-ul', routeName: 'list-devices', tab: 'list' }, // Assuming 'list' route exists
  { name: 'History', icon: 'fa-solid fa-clock-rotate-left', routeName: 'history-setup', tab: 'history' },
  { name: 'Map', icon: 'fa-solid fa-map-location-dot', routeName: 'trackView', tab: 'map' },
  // { name: 'Shop', icon: 'fa-solid fa-cart-shopping', routeName: 'app-shop', tab: 'shop'},
  { name: 'Account', icon: 'fa-solid fa-user', routeName: 'account', tab: 'account' }
];

const navigate = (item) => {
  // If the clicked item doesn't have a routeName, do nothing
  if (!item.routeName) return;

  // If the clicked item is already the active tab, do nothing
  if (route.meta?.activeTab === item.tab) return;
  
  router.push({ name: item.routeName });
};
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-safe-bottom z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
    <div class="flex justify-around items-center h-12">
      <button 
        v-for="item in navItems" 
        :key="item.name"
        @click="navigate(item)"
        class="flex flex-col items-center justify-center w-full h-full transition-colors relative"
        :class="route.meta?.activeTab === item.tab ? 'text-accent' : 'text-gray-400'"
      >
        <i :class="[
          item.icon, 
          'text-xl mb-1 transition-transform', 
          { 'scale-120': route.meta?.activeTab === item.tab }
        ]"></i>
        
        <!--span class="text-[10px] uppercase font-bold tracking-tighter">{{ item.name }}</span-->
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* Optional: Prevent blue highlight on tap for mobile */
button {
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
</style>