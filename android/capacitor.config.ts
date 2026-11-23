import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.lunara.mobile',
  appName: 'Lunara',
  webDir: 'android-web',
  server: {
    url: 'https://lunara.prod.page',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
