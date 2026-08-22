interface TelegramWebApp {
  initData: string;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** El `initData` crudo que manda Telegram, para reenviarlo al backend a validar. */
export function initData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}
