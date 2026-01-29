import {
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithCredential
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Capacitor } from '@capacitor/core'; // (Import Capacitor)
import { auth } from '@/firebase';

/* ------------------------------------------------------------------
 * Nonce utilities (Apple Sign-In requirement)
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

async function sha256(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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

        const result = await FirebaseAuthentication.signInWithGoogle();
        const credential = GoogleAuthProvider.credential(
          result?.credential?.idToken
        );

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

        // CHECK PLATFORM: If Native, use skipNativeAuth (Web Flow)
        if (Capacitor.isNativePlatform()) {
          console.log('[Apple SSO] Native Platform detected. Using skipNativeAuth: true');
          
          // When skipNativeAuth is true, the plugin uses the Firebase JS SDK internally.
          // This handles the nonce automatically and signs the user in directly.
          // We do NOT need to generate a nonce or call signInWithCredential manually.
          const result = await FirebaseAuthentication.signInWithApple({
            skipNativeAuth: true,
            scopes: ['email', 'name']
          });

          console.log('[Apple SSO] Web-flow sign-in completed');
          
          // Return the result (UserCredential-like object) to satisfy the caller
          return result;

        } else {
          // EXISTING LOGIC for Web/Other (Manual Nonce + Double Sign-In)
          
          // 1. Generate a FRESH nonce for this attempt
          const rawNonce = generateNonce();
          const hashedNonce = await sha256(rawNonce);

          console.log('[Apple SSO] Starting with nonce:', rawNonce.substring(0, 10) + '...');

          // 2. Native Apple Sign-In (iOS) with hashed nonce
          const result = await FirebaseAuthentication.signInWithApple({
            nonce: hashedNonce,
            scopes: ['email', 'name']
          });

          console.log('[Apple SSO] Native sign-in completed');

          if (!result?.credential?.idToken) {
            throw new Error('Apple Sign-In failed: missing identity token');
          }

          // 3. Exchange Apple credential for Firebase credential
          // IMPORTANT: Use the original (unhashed) rawNonce here
          const provider = new OAuthProvider('apple.com');
          const credential = provider.credential({
            idToken: result.credential.idToken,
            rawNonce // Use the original unhashed nonce
          });

          console.log('[Apple SSO] Exchanging for Firebase credential');
          const userCredential = await signInWithCredential(auth, credential);
          console.log('[Apple SSO] Success');

          return userCredential;
        }

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

        const result = await FirebaseAuthentication.signInWithFacebook();
        const credential = FacebookAuthProvider.credential(
          result?.credential?.accessToken
        );

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
    default:
      return error?.message || 'Authentication failed.';
  }
};