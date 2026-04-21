
import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user.js';
import { Capacitor } from '@capacitor/core';

// On web (desktop + mobile), use redirect — popup is unreliable on mobile
// because backgrounded tabs get evicted mid-OAuth. On native, the option
// is ignored (native SDKs handle the flow).
const signInMode = Capacitor.isNativePlatform() ? undefined : 'redirect';
/* ------------------------------------------------------------------
 * Auth providers
 * ------------------------------------------------------------------ */

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    color: 'bg-red-500', // Adjusted to standard Google red
    icon: 'fa-brands fa-google', // FontAwesome brand icon
    handler: async () => {
      try {
        console.log('[Google SSO] Starting sign-in');
        const result = await auth.signInWithGoogle({
          scopes: ['email', 'profile'],
          mode: signInMode,
        });
        return result.user;
      } catch (error) {
        console.error('[Google SSO] Error:', error);
        throw error;
      } 
    }
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-600', // Adjusted to standard Facebook blue
    icon: 'fa-brands fa-facebook-f', // FontAwesome brand icon
    handler: async () => {
      try {
        console.log('[Facebook SSO] Starting sign-in');
        const result = await auth.signInWithFacebook({
          scopes: ['email', 'public_profile'],
          mode: signInMode,
          customParameters: [
            { key: 'display', value: 'popup' },
          ],
        });
        return result.user;
      } catch (error) {
        console.error('[Facebook SSO] Error:', error);
        throw error;
      } 
    }
  },
  {
    id: 'apple',
    name: 'Apple',
    color: 'bg-black',
    icon: 'fa-brands fa-apple', // FontAwesome brand icon
    handler: async () => {
      try {
        console.log('[Apple SSO] Starting sign-in');
        const result = await auth.signInWithApple({
          scopes: ['email', 'name'],
          mode: signInMode,
        });

        // Apple only provides the name on FIRST sign-in — capture it immediately
        const displayName = result.user?.displayName
          || result.additionalUserInfo?.profile?.name
          || null;
        if (displayName) {
          const userStore = useUserStore();
          userStore.name = displayName;
          localStorage.setItem('apple_pending_name', displayName);
        }

        return result.user;
      } catch (error) {
        console.error('[Apple SSO] Error:', error);
        throw error;
      }
    }
  }
];

export const signInWithEmailAndPassword = async (email, password) => {
  try {
    console.log('[Email/Password] Starting sign-in');
    const result = await auth.signInWithEmailAndPassword({
      email: email,
      password: password,
    });
    
    return result.user;
  } catch (error) {
    console.error('[Email/Password] Error:', error);
    throw error;
  }
};

export const signOut = async () => {
  try {
    console.log('[Sign Out] Signing out user');
    const result = await auth.signOut()
    console.log('[Sign Out] Sign-out successful');
    return result;
  } catch (error) {
    console.error('[Sign Out] Error:', error);
    throw error;
  }
};

export const sendEmailVerification = async () => {
  try {
    await auth.sendEmailVerification({
      actionCodeSettings: {
        url: 'https://auth.navitag.com/firebase/email-verified',
        handleCodeInApp: false,
      }
    });
  } catch (error) {
    console.error('[Email Verification] Error:', error);
    throw error;
  }
}

export const sendResetPasswordEmail = async (options) => {
  try{
    console.log('[Password Reset] Sending reset email');
    const result = await auth.sendPasswordResetEmail(options);
    console.log('[Password Reset] Reset email sent');
    return result;
  } catch (error) {
    console.error('[Password Reset] Error:', error);
    throw error;
  }
}

export const createUserWithEmailAndPassword = async (email, password) => {
  try {
    console.log('[Email/Password] Starting sign-up'); 
    const result = await auth.createUserWithEmailAndPassword({
      email: email,
      password: password,
    });
    return result.user;
  } catch (error) {
    console.error('[Email/Password] Error:', error);
    throw error;
  }
}

/* ------------------------------------------------------------------
 * Error handling
 * ------------------------------------------------------------------ */

export const getErrorMessage = (error) => {
  switch (error?.code) {
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/email-already-in-use':
      return 'Email is already registered.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with the same email address.';
    case 'auth/invalid-credential':
    case 'auth/invalid-idp-response':
    case 'auth/missing-or-invalid-nonce':
      return 'Sign-in failed. Please try again.';
    case 'auth/credential-already-in-use':
      return 'This credential is already associated with a different account.';
    default:
      return error?.message || 'Authentication failed.';
  }
};

