import { 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  signInWithCredential 
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '@/firebase';

export const supportedProviders = [
  {
    id: 'google',
    name: 'Google',
    icon: 'fa-brands fa-google', // FontAwesome class
    color: 'bg-red-600 hover:bg-red-700',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(result.credential.idToken);
      return signInWithCredential(auth, credential);
    }
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: 'fa-brands fa-facebook-f', // FontAwesome class
    color: 'bg-blue-600 hover:bg-blue-700',
    handler: async () => {
      const result = await FirebaseAuthentication.signInWithFacebook();
      const credential = FacebookAuthProvider.credential(result.credential.accessToken);
      return signInWithCredential(auth, credential);
    }
  }
];

export const getErrorMessage = (error) => {
  // ... keep existing error parser ...
  switch (error.code) {
    case 'auth/user-not-found': return 'No account found with this email.';
    case 'auth/wrong-password': return 'Incorrect password.';
    case 'auth/email-already-in-use': return 'Email is already registered.';
    case 'auth/weak-password': return 'Password should be at least 6 characters.';
    case 'auth/invalid-email': return 'Invalid email address.';
    default: return error.message;
  }
};