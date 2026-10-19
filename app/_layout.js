import { Slot } from 'expo-router';

import App from '../App';

export default function RootLayout() {
  return (
    <App>
      <Slot />
    </App>
  );
}
