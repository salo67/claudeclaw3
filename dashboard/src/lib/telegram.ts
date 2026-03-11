declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        themeParams: Record<string, string>;
        initData: string;
        isExpanded: boolean;
      };
    };
  }
}

export function initTelegramWebApp(): boolean {
  const tg = window.Telegram?.WebApp;
  if (!tg) return false;
  tg.ready();
  tg.expand();
  return true;
}

export function isTelegramWebApp(): boolean {
  return !!window.Telegram?.WebApp?.initData;
}
