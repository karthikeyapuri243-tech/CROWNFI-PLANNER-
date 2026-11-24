import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kram.planner',
  appName: 'KRAM',
  webDir: 'dist',
  android: {
    backgroundColor: '#f8fafc',
    // Keep the WebView content below Android's system status/navigation bars.
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
