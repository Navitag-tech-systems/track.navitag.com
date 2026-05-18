import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

import trackView from '@/views/map/index.vue'
import geoView from '@/views/map/geofence.vue'
import geoEdit from '@/views/map/geofenceEdit.vue'

import LoginView from '@/views/login/index.vue'
import SignupView from '@/views/signup/index.vue'


import LinkDeviceStart from '@/views/linkDevice/start.vue'
import LinkDeviceSelect from '@/views/linkDevice/select.vue'
import LinkDeviceError from '@/views/linkDevice/error.vue'
import LinkDeviceLink from '@/views/linkDevice/link.vue'
import LinkDeviceEnable from '@/views/linkDevice/enable.vue'
import LinkDeviceSuccess from '@/views/linkDevice/success.vue'

import DeviceSettings from './views/lists/deviceSettings.vue'

import ListDevices from '@/views/lists/devices.vue'
import ListGeofences from '@/views/lists/geofences.vue'
import DeviceById from '@/views/lists/deviceById.vue'

import historySetup from '@/views/history/setup.vue'
import historyRoute from '@/views/history/dailyRoute.vue'

import account from '@/views/account/index.vue'

const router = createRouter({
  // createWebHistory works for Capacitor apps (http://localhost or capacitor://)
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'trackView',
      component: trackView,
      meta: { requiresAuth: true, mapRoute: 'track', activeTab: 'map'}
    },
    {
      path: '/addgeo',
      name: 'geoView',
      component: geoView,
      meta: { requiresAuth: true, mapRoute: 'geo-new', activeTab: 'map'}
    },
    {
      path: '/editgeo/:mode/:id',
      //name: 'geoEdit',
      component: geoEdit,
      meta: { requiresAuth: true, mapRoute: true, activeTab: 'map'}
    },
    {
      path: '/linkdevice/select',
      name: 'linkdevice-select',
      component: LinkDeviceSelect,
      meta: { requiresAuth: true, activeTab: false } // set active tab to false to hide bottom nav
    },
    {
      path: '/linkdevice/start',
      name: 'linkdevice-start',
      component: LinkDeviceStart,
      props: {
        showBack: true,
        showShopLink: false,
        scanCopy: 'To activate and link your new GPS tracker to your account, please locate and scan the QR code found on the device.',
        manualCopy: 'Please manually type the 15-digit IMEI found on your tracker to link it.',
      },
      meta: { requiresAuth: true, activeTab: 'list' } // Requires login to link a device
    },
    {
      path: '/linkdevice/error',
      name: 'linkdevice-error',
      component: LinkDeviceError,
      meta: { requiresAuth: true, activeTab: 'list' }
    },
    {
      path: '/linkdevice/link/:imei',
      name: 'linkdevice-link',
      component: LinkDeviceLink,
      meta: { requiresAuth: true, activeTab: 'list' }
    },
    {
      path: '/linkdevice/enable/:imei',
      name: 'linkdevice-enable',
      component: LinkDeviceEnable,
      meta: { requiresAuth: true, activeTab: 'list' }
    },
    {
      path: '/linkdevice/success',
      name: 'linkdevice-success',
      component: LinkDeviceSuccess,
      meta: { requiresAuth: true}
    },
    {
      path: '/account',
      name: 'account',
      component: account,
      meta: { requiresAuth: true, activeTab: 'account' }
    },
    {
      path: '/list/devices',
      name: 'list-devices',
      component: ListDevices,
      meta: { requiresAuth: true, activeTab: 'list' } 
    },
    {
      path: '/list/geofences',
      name: 'list-geofences',
      component: ListGeofences,
      meta: { requiresAuth: true, activeTab: 'list' } 
    },
    {
      path: '/devices/:id',
      name: 'device-detail',
      component: DeviceById,
      meta: { requiresAuth: true, activeTab: 'list' } 
    },
    {
      path: '/history/:imei?', // <-- Notice the '?' here
      name: 'history-setup',
      component: historySetup,
      meta: { requiresAuth: true, activeTab: 'history' } 
    },
    {
      path: '/history/:imei/:date/:mode',
      name: 'history-report',
      component: historyRoute,
      meta: { requiresAuth: true, activeTab: 'history', mapRoute: true } 
    },
    {
      path: '/device/settings/:id',
      name: 'device-settings',
      component: DeviceSettings,
      meta: {requiresAuth: true, activeTab: 'list'}
    },
    {
      path: '/linkdevice/teaser',
      name: 'linkdevice-teaser',
      component: LinkDeviceStart,
      props: {
        showBack: false,
        showShopLink: true,
        scanCopy: 'Locate the QR code on your new device and scan it to link it to your account.',
        manualCopy: 'Type the 15-digit IMEI found on the back of your device to link it.',
      },
      meta: {requiresAuth:true, activeTab: 'lists'}
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView
    },
    {
      path: '/signup',
      name: 'signup',
      component: SignupView
    },
  ]
})

router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  const isAuthenticated = userStore.isLoggedIn

  if (to.meta.requiresAuth && userStore.user === false) {
    console.log('router login redirect')
    next('/login')
  } else if (['login', 'signup'].includes(to.name) && isAuthenticated) {
    next('/')
  } else {
    next()
  }
})

export default router