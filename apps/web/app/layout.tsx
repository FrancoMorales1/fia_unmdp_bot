import Script from 'next/script';

import type { ReactNode } from 'react';

import './globals.css';

export const metadata = { title: 'FI UNMdP' };

/**
 * Carga el SDK de Telegram y aplica `themeParams` como variables CSS antes de
 * pintar nada, para no mostrar un flash con los colores por defecto.
 */
const SCRIPT_APLICAR_TEMA = `
  (function () {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
    var p = tg.themeParams || {};
    var raiz = document.documentElement.style;
    if (p.bg_color) raiz.setProperty('--tg-bg', p.bg_color);
    if (p.text_color) raiz.setProperty('--tg-text', p.text_color);
    if (p.hint_color) raiz.setProperty('--tg-hint', p.hint_color);
    if (p.button_color) raiz.setProperty('--tg-button', p.button_color);
    if (p.button_text_color) raiz.setProperty('--tg-button-text', p.button_text_color);
    if (p.secondary_bg_color) raiz.setProperty('--tg-secondary-bg', p.secondary_bg_color);
  })();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <Script id="tema-telegram" strategy="beforeInteractive">
          {SCRIPT_APLICAR_TEMA}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
