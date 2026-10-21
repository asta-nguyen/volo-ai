import { notFound } from "next/navigation";
import { formatBytes, getLatestRelease, GITHUB_REPOSITORY, PLATFORM_KEYS, type PlatformKey, type ReleaseAsset } from "@/lib/releases";
import { copy, isLocale, type Locale } from "@/lib/site-copy";

type PageProps = { params: Promise<{ locale: string }> };

const platformMarkers: Record<PlatformKey, string> = {
  macos_arm64: "MAC",
  windows_x64: "WIN",
  linux_x64: "LIN",
};

const workflowBars = [20, 36, 28, 58, 42, 70, 48, 82, 55, 96, 62, 76, 43, 88, 54, 72, 34, 64, 41, 80, 52, 68, 30, 48, 24, 56, 34, 66, 39, 58, 26, 44];

export const runtime = "nodejs";

function PlatformAssetLink({
  asset,
  locale,
  downloadLabel,
  platformName,
}: {
  asset: ReleaseAsset;
  locale: Locale;
  downloadLabel: string;
  platformName: string;
}) {
  return (
    <a className="asset-link" href={asset.url} aria-label={`${downloadLabel} ${platformName}: ${asset.name}`}>
      <span className="asset-format">{asset.format.slice(1).toUpperCase()}</span>
      <span className="asset-description">
        <span className="asset-name">{asset.name}</span>
        <span className="asset-size">{formatBytes(asset.size, locale)}</span>
      </span>
      <span className="asset-action">
        {downloadLabel} <span aria-hidden="true">↓</span>
      </span>
    </a>
  );
}

export default async function LocaleHomePage({ params }: PageProps) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) notFound();

  const locale = requestedLocale;
  const text = copy[locale];
  const release = await getLatestRelease();
  const localeCode = locale === "vi" ? "vi-VN" : "en-US";

  let releaseDate = "";
  if (release.kind === "available") {
    releaseDate = new Intl.DateTimeFormat(localeCode, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(release.publishedAt));
  }

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
          <a href="#about">{text.aboutLink}</a>
          <a href="#downloads">{text.downloadLink}</a>
          <a href={`/${locale}/changelog`}>{text.changelogLink}</a>
          <a href={`https://github.com/${GITHUB_REPOSITORY}`}>GitHub <span aria-hidden="true">↗</span></a>
        </nav>

        <div className="header-actions">
          <div className="language-switch" aria-label={text.languageLabel}>
            <a href="/en" lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</a>
            <span aria-hidden="true">/</span>
            <a href="/vi" lang="vi" aria-current={locale === "vi" ? "page" : undefined}>VI</a>
          </div>
          <a className="header-download" href="#downloads">{text.downloadLink}</a>
        </div>
      </header>

      <main id="main-content">
        <section className="hero page-shell" aria-labelledby="hero-title">
          <div className="hero-copy flex flex-col items-start">
            <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />{text.heroEyebrow}</p>
            <h1 id="hero-title">
              {text.heroTitle}<br />
              <em>{text.heroAccent}</em>
            </h1>
            <p className="hero-description">{text.heroBody}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#downloads">
                {text.heroAction} <span aria-hidden="true">↘</span>
              </a>
              <a className="button button-secondary" href={`https://github.com/${GITHUB_REPOSITORY}`}>
                {text.sourceAction} <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="hero-footnote"><span aria-hidden="true">↳</span>{text.heroFootnote}</p>
          </div>

          <div className="workflow-panel" role="group" aria-label={text.workflowLabel}>
            <div className="workflow-topline">
              <span className="workflow-label">{text.workflowLabel}</span>
              <span className="workflow-status"><span aria-hidden="true" />{text.workflowStatus}</span>
            </div>
            <div className="waveform" aria-hidden="true">
              {workflowBars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="workflow-steps">
              <div className="workflow-step">
                <span className="step-label">{text.workflowInput}</span>
                <p>{text.workflowQuote}</p>
              </div>
              <div className="workflow-connector" aria-hidden="true">→</div>
              <div className="workflow-step workflow-step-output">
                <span className="step-label">{text.workflowModel}</span>
                <p>{text.workflowModels}</p>
                <span className="step-label output-label">{text.workflowOutput}</span>
                <p className="output-format">{text.workflowFormats}</p>
              </div>
            </div>
            <p className="workflow-footer"><span aria-hidden="true">✳</span>{text.workflowFootnote}</p>
            <span className="workflow-index" aria-hidden="true">01—03</span>
          </div>
        </section>

        <section className="about-section page-shell" id="about" aria-labelledby="about-title">
          <div className="section-heading">
            <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />{text.aboutEyebrow}</p>
            <h2 id="about-title">{text.aboutTitle}</h2>
          </div>
          <div className="feature-list grid">
            {text.features.map((feature, index) => (
              <article className="feature-item" key={feature.label}>
                <span className="feature-index">0{index + 1}</span>
                <div>
                  <p className="feature-label">{feature.label}</p>
                  <h3>{feature.title}</h3>
                  <p className="feature-body">{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="downloads-section" id="downloads" aria-labelledby="downloads-title">
          <div className="page-shell downloads-inner">
            <div className="downloads-heading">
              <div>
                <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true" />{text.downloadsEyebrow}</p>
                <h2 id="downloads-title">{text.downloadsTitle}</h2>
                <p className="downloads-intro">{text.downloadsIntro}</p>
              </div>
              <span className="platform-count"><b>03</b> {locale === "vi" ? "hệ điều hành" : "platforms"}</span>
            </div>

            <div className={`release-banner release-${release.kind}`} aria-live="polite">
              {release.kind === "available" ? (
                <>
                  <div className="release-mark" aria-hidden="true">↗</div>
                  <div className="release-copy">
                    <p className="release-label">{text.latestRelease}</p>
                    <h3>{release.tag}</h3>
                    <p>{text.publishedOn} <time dateTime={release.publishedAt}>{releaseDate}</time></p>
                  </div>
                  <a className="release-notes" href={release.notesUrl}>{text.releaseNotes}<span aria-hidden="true"> ↗</span></a>
                </>
              ) : (
                <>
                  <div className="release-mark" aria-hidden="true">{release.kind === "no-release" ? "…" : "!"}</div>
                  <div className="release-copy">
                    <p className="release-label">{text.downloadsEyebrow}</p>
                    <h3>{release.kind === "no-release" ? text.noReleaseTitle : text.unavailableTitle}</h3>
                    <p>{release.kind === "no-release" ? text.noReleaseBody : text.unavailableBody}</p>
                  </div>
                  <a className="release-notes" href={`https://github.com/${GITHUB_REPOSITORY}/releases`}>
                    {text.releasesLink}<span aria-hidden="true"> ↗</span>
                  </a>
                </>
              )}
            </div>

            <div className="platform-list grid">
              {PLATFORM_KEYS.map((key) => {
                const assets = release.kind === "available" ? release.platforms[key] : [];
                const platform = text.platforms[key];
                const emptyMessage = release.kind === "no-release"
                  ? text.noBuildYet
                  : release.kind === "available"
                    ? text.missingBuild
                    : text.unableToCheck;

                return (
                  <article className="platform-row" key={key}>
                    <div className="platform-main">
                      <div className="platform-heading">
                        <span className="platform-marker" aria-hidden="true">{platformMarkers[key]}</span>
                        <div className="platform-copy">
                          <h3>{platform.name}</h3>
                          <p>{platform.architecture}</p>
                        </div>
                      </div>
                      <div className="platform-assets grid">
                        {assets.length > 0 ? assets.map((asset) => (
                          <PlatformAssetLink
                            key={asset.name}
                            asset={asset}
                            locale={locale}
                            downloadLabel={text.downloadFile}
                            platformName={platform.name}
                          />
                        )) : <p className="platform-unavailable">{emptyMessage}</p>}
                      </div>
                    </div>

                    {key === "macos_arm64" && (
                      <div className="mac-help">
                        <p className="mac-warning"><span aria-hidden="true">!</span>{text.macWarning}</p>
                        <details className="help-disclosure">
                          <summary>{text.macHelpTitle}</summary>
                          <div className="help-content">
                            <p className="help-caution">{text.macTrustNotice}</p>
                            <ol>
                              <li>{text.openStepOne}</li>
                              <li>{text.openStepTwo}</li>
                            </ol>
                            <a className="help-source" href="https://support.apple.com/en-ie/102445">{text.appleSafetyLink}<span aria-hidden="true"> ↗</span></a>
                            <div className="damaged-note">
                              <h4>{text.damagedTitle}</h4>
                              <p>{text.damagedBody}</p>
                            </div>
                            <details className="advanced-disclosure">
                              <summary>{text.advancedTitle}</summary>
                              <div className="advanced-content">
                                <p>{text.advancedReason}</p>
                                <p className="advanced-risk">{text.advancedRisk}</p>
                                <ol>
                                  <li>
                                    {text.advancedDisable}
                                    <code>sudo spctl --master-disable</code>
                                  </li>
                                  <li>
                                    {text.advancedEnable}
                                    <code>sudo spctl --master-enable</code>
                                  </li>
                                  <li>
                                    {text.advancedCheck}
                                    <code>spctl --status</code>
                                  </li>
                                </ol>
                                <p className="admin-password">{text.adminPassword}</p>
                                <a className="help-source" href="https://help.apple.com/xcode/mac/current/en.lproj/dev9b7736b0e.html">{text.appleCommandLink}<span aria-hidden="true"> ↗</span></a>
                              </div>
                            </details>
                          </div>
                        </details>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="download-footer">
              <span>{locale === "vi" ? "Không tìm thấy bản phù hợp?" : "Need a different build?"}</span>
              <a href={`https://github.com/${GITHUB_REPOSITORY}/releases`}>{text.releasesLink}<span aria-hidden="true"> ↗</span></a>
            </div>
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
          <a href={`https://github.com/${GITHUB_REPOSITORY}`}>GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </footer>
    </>
  );
}
