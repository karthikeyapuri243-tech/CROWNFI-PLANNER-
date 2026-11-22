import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kram.planner',
  appName: 'KRAM',
  webDir: 'dist',
  android: {
    backgroundColor: '#f8fafc',
  },
  plugins: {
    SocialLogin: {
      providers: { google: true },
      logLevel: 1,
    },
  },
};

export default config;
