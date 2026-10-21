import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { copy, isLocale } from "@/lib/site-copy";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const localeCopy = copy[locale];
  return {
    title: localeCopy.featuresMetadataTitle,
    description: localeCopy.featuresMetadataDescription,
  };
}

export default async function FeaturesPage({ params }: PageProps) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) notFound();

  const locale = requestedLocale;
  const text = copy[locale];

  return (
    <>
      <a className="skip-link" href="#main-content">
        {locale === "vi" ? "Chuyển đến nội dung chính" : "Skip to main content"}
      </a>

      <header className="site-header page-shell">
        <a className="brand" href={`/${locale}`} aria-label="Volo AI home">
          <span className="brand-mark" aria-hidden="true">v</span>
          <span className="brand-name">volo<span>ai</span></span>
        </a>

        <nav className="main-navigation" aria-label={text.navigation}>
          <a href={`/${locale}`}>{text.homeLink}</a>
          <a href={`/${locale}/features`} aria-current="page">{text.featuresLink}</a>
          <a href={`/${locale}/changelog`}>{text.changelogLink}</a>
        </nav>

        <div className="header-actions">
          <div className="language-switch" aria-label={text.languageLabel}>
            <a href="/en/features" lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</a>
            <span aria-hidden="true">/</span>
            <a href="/vi/features" lang="vi" aria-current={locale === "vi" ? "page" : undefined}>VI</a>
          </div>
          <a className="header-download" href={`/${locale}#downloads`}>{text.downloadLink}</a>
        </div>
      </header>

      <main id="main-content">
        <section className="changelog-section page-shell" aria-labelledby="features-title">
          <div className="changelog-head">
            <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />{text.featuresEyebrow}</p>
            <h1 id="features-title">
              {text.featuresTitle}<br />
              <em>{text.featuresAccent}</em>
            </h1>
            <p className="changelog-intro">{text.featuresIntro}</p>
          </div>

          <div className="feature-groups">
            {text.featureGroups.map((group, index) => {
              const groupId = `feature-group-${index + 1}`;
              return (
                <section className="feature-group" key={group.label} aria-labelledby={groupId}>
                  <div className="feature-group-head">
                    <span className="feature-group-index" aria-hidden="true">0{index + 1}</span>
                    <p className="feature-label">{group.label}</p>
                    <h2 id={groupId}>{group.title}</h2>
                    <p className="feature-group-intro">{group.intro}</p>
                  </div>
                  <div className="feature-group-items">
                    {group.items.map((item) => (
                      <article className="feature-card" key={item.title}>
                        <h3>{item.title}</h3>
                        <p>{item.body}</p>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="release-banner release-available features-outro">
            <div className="release-mark" aria-hidden="true">↓</div>
            <div className="release-copy">
              <p className="release-label">{text.downloadsEyebrow}</p>
              <h2>{text.featuresOutroTitle}</h2>
              <p>{text.featuresOutroBody}</p>
            </div>
            <a className="release-notes" href={`/${locale}#downloads`}>
              {text.heroAction}<span aria-hidden="true"> ↗</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer page-shell">
        <a className="brand footer-brand" href={`/${locale}`} aria-label="Volo AI home">
          <span className="brand-mark" aria-hidden="true">v</span>
          <span className="brand-name">volo<span>ai</span></span>
        </a>
        <p>{text.footerText}</p>
        <div className="footer-meta">
          <span>{text.footerNote}</span>
        </div>
      </footer>
    </>
  );
}
