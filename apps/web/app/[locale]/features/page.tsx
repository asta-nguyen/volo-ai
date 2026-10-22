import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IconArrowRight, IconDownload, IconGithub } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { GITHUB_REPOSITORY } from "@/lib/releases";
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

      <SiteHeader locale={locale} text={text} kind="features" />

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

          <section className="community-section" aria-labelledby="community-title">
            <p className="eyebrow">{text.communityEyebrow}</p>
            <h2 id="community-title">{text.communityTitle}</h2>
            <p className="community-description">{text.communityBody}</p>
            <div className="hero-actions">
              <a
                className="button button-primary"
                href={`https://github.com/${GITHUB_REPOSITORY}/discussions/categories/ideas`}
              >
                {text.suggestFeature}<IconArrowRight />
              </a>
              <a className="button button-secondary" href={`https://github.com/${GITHUB_REPOSITORY}`}>
                <IconGithub />{text.starProject}
              </a>
            </div>
            <p className="community-note">{text.communityNotice}</p>
          </section>

          <div className="release-banner release-available features-outro">
            <div className="release-mark" aria-hidden="true"><IconDownload /></div>
            <div className="release-copy">
              <p className="release-label">{text.downloadsEyebrow}</p>
              <h2>{text.featuresOutroTitle}</h2>
              <p>{text.featuresOutroBody}</p>
            </div>
            <a className="release-notes" href={`/${locale}#downloads`}>
              {text.heroAction}<IconArrowRight />
            </a>
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} text={text} />
    </>
  );
}
