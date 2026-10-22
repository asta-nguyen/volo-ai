import Script from "next/script";
import "../globals.css";

export default function DefaultRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        {children}
        <Script
          defer
          src="https://umami.n2q.site/script.js"
          data-website-id="8211b2f9-c053-475c-a0fb-a4b18f551ba0"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
