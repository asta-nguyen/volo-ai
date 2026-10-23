"use client";

import Script from "next/script";

declare global {
  interface Window {
    kofiWidgetOverlay?: {
      draw: (
        pageId: string,
        config: {
          type: "floating-chat";
          "floating-chat.donateButton.text": string;
          "floating-chat.donateButton.background-color": string;
          "floating-chat.donateButton.text-color": string;
        },
      ) => void;
    };
  }
}

export function KofiWidget() {
  return (
    <Script
      src="https://storage.ko-fi.com/cdn/scripts/overlay-widget.js"
      strategy="afterInteractive"
      onReady={() => {
        const widget = window.kofiWidgetOverlay;
        if (!widget) return;

        const label = document.documentElement.lang === "vi"
          ? "Ủng hộ Volo AI"
          : "Support Volo AI";
        widget.draw("n2q1910", {
          type: "floating-chat",
          "floating-chat.donateButton.text": label,
          "floating-chat.donateButton.background-color": "#b85e43",
          "floating-chat.donateButton.text-color": "#ffffff",
        });
      }}
    />
  );
}
