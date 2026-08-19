
import { auth } from '@/firebase';
import { useUserStore } from '@/stores/user.js';
import { Capacitor } from '@capacitor/core';

// On web (desktop + mobile), use redirect — popup is unreliable on mobile
// because backgrounded tabs get evicted mid-OAuth. On native, the option
// is ignored (native SDKs handle the flow).
//
// DEV IS THE EXCEPTION, and it is a limitation of Firebase, not of this app.
// signInWithRedirect can only hand the credential back when the app is served
// from the same origin as authDomain. In production that holds — the app and
// authDomain are both track.navitag.com — but a dev server on localhost:5173 is
// cross-origin to it, so the handler completes on track.navitag.com and cannot
// return the session to localhost. The visible symptom is a full round trip
// through the IdP that dumps you back on the login screen, signed in nowhere.
// Popup has no such limit: the credential comes back by postMessage to the
// opener, so it works cross-origin. This affects Google and Apple identically —
// it is not specific to any one provider. Prod builds are untouched: DEV is
// false for `vite build`, so shipped bundles still use redirect.
const signInMode = Capacitor.isNativePlatform()
  ? undefined
  : import.meta.env.DEV
    ? 'popup'
    : 'redirect';
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
  },
  // Microsoft is WEB-ONLY, and the spread below is what enforces that. Native
  // has none of the setup it would need: capacitor.config.json's
  // FirebaseAuthentication.providers list is google.com + apple.com only, and
  // the iOS/Android SDKs would each also need the Microsoft OAuth redirect URI
  // registered against the app's custom scheme. Rendering the button inside the
  // native shell would hand those users a button that can only ever throw, so
  // it is dropped from the array entirely rather than shown and disabled.
  ...(Capacitor.isNativePlatform() ? [] : [
    {
      id: 'microsoft',
      name: 'Microsoft',
      color: 'bg-[#0078d4]',
      icon: 'fa-brands fa-windows',
      handler: async () => {
        try {
          console.log('[Microsoft SSO] Starting sign-in');
          const result = await auth.signInWithMicrosoft({
            scopes: ['openid', 'email', 'profile'],
            mode: signInMode,
          });
          return result.user;
        } catch (error) {
          console.error('[Microsoft SSO] Error:', error);
          throw error;
        }
      }
    }
  ]),
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
    // No actionCodeSettings on purpose. The only thing it carried was a
    // continueUrl pointing at https://auth.navitag.com/firebase/email-verified
    // — a route that does not exist in that app's router, where the SPA rewrite
    // serves 200 and the catch-all renders "Page Not Found". Nothing ever
    // dereferenced it (ActionHandler.vue does not read continueUrl; it renders
    // its own success state and tells the user to close the page), so it was
    // dead config aimed at a dead route — and a live bug waiting for the day
    // someone adds a "Continue" button to that handler.
    //
    // Dropping it does NOT change where the email link goes: that destination
    // is the action-handler URL configured in the Firebase console's email
    // template (auth.navitag.com/action), not this setting. handleCodeInApp
    // was already Firebase's default of false.
    await auth.sendEmailVerification();
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

