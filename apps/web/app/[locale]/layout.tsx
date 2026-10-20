import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { notFound } from "next/navigation";
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
      <body className={manrope.className}>{children}</body>
    </html>
  );
}
