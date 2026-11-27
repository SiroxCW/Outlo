import type { OutloBridge } from '@shared/api';

declare global {
  interface Window {
    outlo: OutloBridge;
  }
}
