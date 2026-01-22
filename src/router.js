import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import HomeView from '@/views/home/index.vue'
import LoginView from '@/views/login/index.vue'
import SignupView from '@/views/signup/index.vue'
import ForgotPasswordView from '@/views/pwReset/index.vue'

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