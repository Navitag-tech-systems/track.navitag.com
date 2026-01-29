import {
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithCredential
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '@/firebase';

/* ------------------------------------------------------------------
 * Nonce utilities
 * ------------------------------------------------------------------ */

function generateNonce(length = 32) {
  const charset =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
  let result = '';
  const values = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
  }
  return result;
}

/* ------------------------------------------------------------------
 * Prevent duplicate sign-in attempts
 * ------------------------------------------------------------------ */

const signingIn = {
  google: false,
  apple: false,
  facebook: false
};

/* ------------------------------------------------------------------
 * Auth providers
 * ------------------------------------------------------------------ */

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    color: 'bg-red-400',
    handler: async () => {
      if (signingIn.google) {
        throw new Error('Sign-in already in progress');
      }

      try {
        signingIn.google = true;

        // Use skipNativeAuth: true to get credentials without native sign-in
        const result = await FirebaseAuthentication.signInWithGoogle({
          skipNativeAuth: true
        });
        
        const credential = GoogleAuthProvider.credential(
          result?.credential?.idToken
        );

        // Sign in on web layer only
        return await signInWithCredential(auth, credential);
      } finally {
        signingIn.google = false;
      }
    }
  },

  {
    id: 'apple',
    name: 'Apple',
    color: 'bg-black',
    handler: async () => {
      if (signingIn.apple) {
        throw new Error('Sign-in already in progress');
      }

      try {
        signingIn.apple = true;

        const rawNonce = generateNonce();
        
        console.log('[Apple SSO] Starting sign-in');

        // Use skipNativeAuth: true - this prevents native Firebase sign-in
        // but still gives you the native Apple Sign-In UI
        const result = await FirebaseAuthentication.signInWithApple({
          skipNativeAuth: true,  // KEY CHANGE: Set to true
          nonce: rawNonce,
          scopes: ['email', 'name']
        });

        if (!result?.credential?.idToken) {
          throw new Error('Apple Sign-In failed: missing identity token');
        }

        const provider = new OAuthProvider('apple.com');
        const credential = provider.credential({
          idToken: result.credential.idToken,
          rawNonce: rawNonce
        });

        console.log('[Apple SSO] Exchanging credential with Firebase');

        // Sign in on web layer only
        const userCredential = await signInWithCredential(auth, credential);

        console.log('[Apple SSO] Firebase sign-in successful');

        return userCredential;
      } catch (error) {
        console.error('[Apple SSO] Error:', error);
        throw error;
      } finally {
        signingIn.apple = false;
      }
    }
  },

  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-400',
    handler: async () => {
      if (signingIn.facebook) {
        throw new Error('Sign-in already in progress');
      }

      try {
        signingIn.facebook = true;

        // Use skipNativeAuth: true
        const result = await FirebaseAuthentication.signInWithFacebook({
          skipNativeAuth: true
        });
        
        const credential = FacebookAuthProvider.credential(
          result?.credential?.accessToken
        );

        // Sign in on web layer only
        return await signInWithCredential(auth, credential);
      } finally {
        signingIn.facebook = false;
      }
    }
  }
];

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