import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { notFound } from "next/navigation";
import Script from "next/script";
import { copy, isLocale } from "@/lib/site-copy";
import "../globals.css";

const manrope = Manrope({
  subsets: ["latin", "vietnamese"],
  variable: "--font-manrope",
  display: "swap",
});

type LocaleParams = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const localeCopy = copy[locale];
  return {
    title: localeCopy.metadataTitle,
    description: localeCopy.metadataDescription,
  };
}

export default async function LocaleRootLayout({
  children,
  params,
}: Readonly<LocaleParams & { children: React.ReactNode }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale}>
      <body className={manrope.className}>
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
