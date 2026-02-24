import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user-backup'

import trackView from '@/views/map/index.vue'
import geoView from '@/views/map/geofence.vue'

import LoginView from '@/views/login/index.vue'
import SignupView from '@/views/signup/index.vue'
import ForgotPasswordView from '@/views/pwReset/index.vue'
import authCallback from '@/views/authCallback/index.vue';

import LinkDeviceStart from '@/views/linkDevice/start.vue'
import LinkDeviceSelect from '@/views/linkDevice/select.vue'
import LinkDeviceError from '@/views/linkDevice/error.vue'
import LinkDeviceLink from '@/views/linkDevice/link.vue'
import LinkDeviceEnable from '@/views/linkDevice/enable.vue'
import LinkDeviceSuccess from '@/views/linkDevice/success.vue'
import LinkDeviceTeaser from '@/views/linkDevice/addOrBuy.vue'

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
      path: '/linkdevice/select',
      name: 'linkdevice-select',
      component: LinkDeviceSelect,
      meta: { requiresAuth: true, activeTab: 'add' } // Requires login to link a device
    },
    {
      path: '/linkdevice/start',
      name: 'linkdevice-start',
      component: LinkDeviceStart,
      meta: { requiresAuth: true, activeTab: 'add' } // Requires login to link a device
    },
    {
      path: '/linkdevice/error',
      name: 'linkdevice-error',
      component: LinkDeviceError,
      meta: { requiresAuth: true, activeTab: 'add' }
    },
    {
      path: '/linkdevice/link/:imei',
      name: 'linkdevice-link',
      component: LinkDeviceLink,
      meta: { requiresAuth: true, activeTab: 'add' }
    },
    {
      path: '/linkdevice/enable/:imei',
      name: 'linkdevice-enable',
      component: LinkDeviceEnable,
      meta: { requiresAuth: true, activeTab: 'add' }
    },
    {
      path: '/linkdevice/success',
      name: 'linkdevice-success',
      component: LinkDeviceSuccess,
      meta: { requiresAuth: true, activeTab: 'add' }
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
      path: '/history/:imei/:date',
      name: 'history-report',
      component: historyRoute,
      meta: { requiresAuth: true, activeTab: 'history', mapRoute: 'route' } 
    },

    {
      path: '/linkdevice/teaser',
      name: 'linkdevice-success',
      component: LinkDeviceTeaser,
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
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: ForgotPasswordView
    },
    {
      path: '/auth/action', // <--- The callback route
      name: 'auth-action',
      component: authCallback
    }
  ]
})

router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  const isAuthenticated = userStore.isLoggedIn

  if (to.meta.requiresAuth && !isAuthenticated && !userStore.loading) {
    next('/login')
  } else if (['login', 'signup', 'forgot-password'].includes(to.name) && isAuthenticated) {
    next('/')
  } else {
    next()
  }
})

export default router