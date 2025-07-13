import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.piehouse.focusmatrix',
  appName: 'FocusMatrix',
  webDir: 'dist',

  /* ▼ NEW ▼ */
  server: {
    url: 'https://pomodoro.thepi.es',   // the HTTPS origin that serves your PWA
    cleartext: false                    // block accidental http:// loads
  }
};
export default config;
