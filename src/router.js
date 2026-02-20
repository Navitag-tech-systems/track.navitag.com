import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import HomeView from '@/views/home/index.vue'
import LoginView from '@/views/login/index.vue'
import SignupView from '@/views/signup/index.vue'
import ForgotPasswordView from '@/views/pwReset/index.vue'
import authCallback from '@/views/authCallback/index.vue';

import LinkDeviceStart from '@/views/linkDevice/start.vue'
import LinkDeviceError from '@/views/linkDevice/error.vue'
import LinkDeviceLink from '@/views/linkDevice/link.vue'
import LinkDeviceEnable from '@/views/linkDevice/enable.vue'
import LinkDeviceSuccess from '@/views/linkDevice/success.vue'


const router = createRouter({
  // createWebHistory works for Capacitor apps (http://localhost or capacitor://)
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { requiresAuth: true }
    },
    {
      path: '/linkdevice/start',
      name: 'linkdevice-start',
      component: LinkDeviceStart,
      meta: { requiresAuth: true } // Requires login to link a device
    },
    {
      path: '/linkdevice/error',
      name: 'linkdevice-error',
      component: LinkDeviceError,
      meta: { requiresAuth: true }
    },
    {
      path: '/linkdevice/link/:imei',
      name: 'linkdevice-link',
      component: LinkDeviceLink,
      meta: { requiresAuth: true }
    },
    {
      path: '/linkdevice/enable/:imei',
      name: 'linkdevice-enable',
      component: LinkDeviceEnable,
      meta: { requiresAuth: true }
    },
    {
      path: '/linkdevice/success',
      name: 'linkdevice-success',
      component: LinkDeviceSuccess,
      meta: { requiresAuth: true }
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