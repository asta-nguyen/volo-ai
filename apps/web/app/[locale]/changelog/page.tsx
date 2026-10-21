import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getChangelogEntries, renderChangelogMarkdown } from "@/lib/changelog";
import { formatBytes, getReleaseForTag, PLATFORM_KEYS, type PlatformKey, type ReleaseAsset, type TagRelease } from "@/lib/releases";
import { copy, isLocale, type Locale } from "@/lib/site-copy";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const localeCopy = copy[locale];
  return {
    title: localeCopy.changelogMetadataTitle,
    description: localeCopy.changelogMetadataDescription,
  };
}

function hasAssets(release: TagRelease): release is TagRelease & { kind: "available" } {
  return release.kind === "available" && PLATFORM_KEYS.some((key) => release.platforms[key].length > 0);
}

function ChangelogDownloads({
  release,
  locale,
  platformNames,
  unavailableLabel,
  downloadsLabel,
}: {
  release: TagRelease;
  locale: Locale;
  platformNames: Record<PlatformKey, { name: string }>;
  unavailableLabel: string;
  downloadsLabel: string;
}) {
  if (!hasAssets(release)) {
    return <p className="changelog-download-status">{unavailableLabel}</p>;
  }

  return (
    <div className="changelog-downloads" role="group" aria-label={downloadsLabel}>
      {PLATFORM_KEYS.map((key: PlatformKey) => {
        const assets: ReleaseAsset[] = release.platforms[key];
        if (assets.length === 0) return null;

        return (
          <div className="changelog-download-group" key={key}>
            <span className="changelog-download-platform">{platformNames[key].name}</span>
            {assets.map((asset) => (
              <a
                className="changelog-download-link"
                key={asset.name}
                href={asset.url}
                aria-label={`${downloadsLabel} ${platformNames[key].name}: ${asset.name}`}
              >
                <span className="changelog-download-name">{asset.name}</span>
                <span className="changelog-download-size">{formatBytes(asset.size, locale)}</span>
                <span aria-hidden="true">↓</span>
              </a>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default async function ChangelogPage({ params }: PageProps) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) notFound();

  const locale = requestedLocale;
  const text = copy[locale];
  const entries = await getChangelogEntries();
  const downloads = await Promise.all(entries.map((entry) => getReleaseForTag(entry.tag)));

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
          <a href={`/${locale}/features`}>{text.featuresLink}</a>
          <a href={`/${locale}/changelog`} aria-current="page">{text.changelogLink}</a>
        </nav>

        <div className="header-actions">
          <div className="language-switch" aria-label={text.languageLabel}>
            <a href="/en/changelog" lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</a>
            <span aria-hidden="true">/</span>
            <a href="/vi/changelog" lang="vi" aria-current={locale === "vi" ? "page" : undefined}>VI</a>
          </div>
          <a className="header-download" href={`/${locale}#downloads`}>{text.downloadLink}</a>
        </div>
      </header>

      <main id="main-content">
        <section className="changelog-section page-shell" aria-labelledby="changelog-title">
          <div className="changelog-head">
            <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />{text.changelogEyebrow}</p>
            <h1 id="changelog-title">
              {text.changelogTitle}<br />
              <em>{text.changelogAccent}</em>
            </h1>
            <p className="changelog-intro">{text.changelogIntro}</p>
          </div>

          {entries.length > 0 ? (
            <ol className="changelog-list">
              {entries.map((entry, index) => (
                <li key={entry.tag}>
                  <article className="changelog-entry">
                    <div className="changelog-entry-head">
                      <div className="changelog-entry-meta">
                        <h2>{entry.tag}</h2>
                      </div>
                    </div>
                    {entry.body !== "" && (
                      <div
                        className="changelog-notes"
                        dangerouslySetInnerHTML={{ __html: renderChangelogMarkdown(entry.body) }}
                      />
                    )}
                    <ChangelogDownloads
                      release={downloads[index]}
                      locale={locale}
                      platformNames={text.platforms}
                      unavailableLabel={text.changelogDownloadUnavailable}
                      downloadsLabel={text.downloadsEyebrow}
                    />
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <div className="release-banner changelog-state release-no-release" aria-live="polite">
              <div className="release-mark" aria-hidden="true">…</div>
              <div className="release-copy">
                <p className="release-label">{text.changelogEyebrow}</p>
                <h2>{text.changelogEmptyTitle}</h2>
                <p>{text.changelogEmptyBody}</p>
              </div>
            </div>
          )}
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
