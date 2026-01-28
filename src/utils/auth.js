import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  OAuthProvider, 
  signInWithCredential 
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '@/firebase';

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    color: 'bg-red-400',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(result.credential.idToken);
      return signInWithCredential(auth, credential);
    }
  },
  {
    id: 'apple',
    name: 'Apple',
    color: 'bg-black',
    handler: async () => {
      // 1. Start the sign-in process
      const result = await FirebaseAuthentication.signInWithApple();
      
      // 2. CHECK: If the plugin already signed the user in, just return the user
      if (result.user) {
        return result; 
      }

      // 3. Fallback: Only if result.user is missing (e.g., skipNativeAuth was true)
      const provider = new OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken: result.credential.idToken,
        rawNonce: result.credential.rawNonce, // Ensure this is correctly named from result
      });
      return signInWithCredential(auth, credential);
    }
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-400',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithFacebook();
      const credential = FacebookAuthProvider.credential(result.credential.accessToken);
      return signInWithCredential(auth, credential);
    }
  }
];

export const getErrorMessage = (error) => {
  switch (error.code) {
    case 'auth/user-not-found': return 'No account found with this email.';
    case 'auth/wrong-password': return 'Incorrect password.';
    case 'auth/email-already-in-use': return 'Email is already registered.';
    case 'auth/weak-password': return 'Password should be at least 6 characters.';
    case 'auth/invalid-email': return 'Invalid email address.';
    case 'auth/account-exists-with-different-credential': return 'An account already exists with the same email address.';
    default: return error.message;
  }
};