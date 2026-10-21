import { notFound } from "next/navigation";
import {
  IconAlert,
  IconApple,
  IconArrowRight,
  IconChevronDown,
  IconClock,
  IconDownload,
  IconExternal,
  IconGithub,
  IconInfo,
  IconLinux,
  IconRelease,
  IconSpark,
  IconWindows,
} from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { formatBytes, getLatestRelease, GITHUB_REPOSITORY, PLATFORM_KEYS, type PlatformKey, type ReleaseAsset } from "@/lib/releases";
import { copy, isLocale, type Locale } from "@/lib/site-copy";

type PageProps = { params: Promise<{ locale: string }> };

const platformIcons: Record<PlatformKey, typeof IconApple> = {
  macos_arm64: IconApple,
  windows_x64: IconWindows,
  linux_x64: IconLinux,
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
        {downloadLabel} <IconDownload />
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

      <SiteHeader locale={locale} text={text} />

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
                {text.heroAction} <IconDownload />
              </a>
              <a className="button button-secondary" href={`https://github.com/${GITHUB_REPOSITORY}`}>
                <IconGithub /> {text.sourceAction}
              </a>
            </div>
            <p className="hero-footnote"><IconInfo />{text.heroFootnote}</p>
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
              <div className="workflow-connector" aria-hidden="true"><IconArrowRight /></div>
              <div className="workflow-step workflow-step-output">
                <span className="step-label">{text.workflowModel}</span>
                <p>{text.workflowModels}</p>
                <span className="step-label output-label">{text.workflowOutput}</span>
                <p className="output-format">{text.workflowFormats}</p>
              </div>
            </div>
            <p className="workflow-footer"><IconSpark />{text.workflowFootnote}</p>
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
            <p className="features-home-cta">
              <a className="button button-secondary" href={`/${locale}/features`}>
                {text.featuresCta} <IconArrowRight />
              </a>
            </p>
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
                  <div className="release-mark" aria-hidden="true"><IconRelease /></div>
                  <div className="release-copy">
                    <p className="release-label">{text.latestRelease}</p>
                    <h3>{release.tag}</h3>
                    <p>{text.publishedOn} <time dateTime={release.publishedAt}>{releaseDate}</time></p>
                  </div>
                  <a className="release-notes" href={release.notesUrl}>{text.releaseNotes}<IconExternal /></a>
                </>
              ) : (
                <>
                  <div className="release-mark" aria-hidden="true">
                    {release.kind === "no-release" ? <IconClock /> : <IconAlert />}
                  </div>
                  <div className="release-copy">
                    <p className="release-label">{text.downloadsEyebrow}</p>
                    <h3>{release.kind === "no-release" ? text.noReleaseTitle : text.unavailableTitle}</h3>
                    <p>{release.kind === "no-release" ? text.noReleaseBody : text.unavailableBody}</p>
                  </div>
                  <a className="release-notes" href={`https://github.com/${GITHUB_REPOSITORY}/releases`}>
                    {text.releasesLink}<IconExternal />
                  </a>
                </>
              )}
            </div>

            <div className="platform-list grid">
              {PLATFORM_KEYS.map((key) => {
                const PlatformIcon = platformIcons[key];
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
                        <span className="platform-marker" aria-hidden="true">
                          <PlatformIcon />
                        </span>
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
                        <p className="mac-warning"><span aria-hidden="true"><IconAlert /></span>{text.macWarning}</p>
                        <details className="help-disclosure">
                          <summary>{text.macHelpTitle}<span className="disclosure-icon" aria-hidden="true"><IconChevronDown /></span></summary>
                          <div className="help-content">
                            <p className="help-caution">{text.macTrustNotice}</p>
                            <ol>
                              <li>{text.openStepOne}</li>
                              <li>{text.openStepTwo}</li>
                            </ol>
                            <a className="help-source" href="https://support.apple.com/en-ie/102445">{text.appleSafetyLink}<IconExternal /></a>
                            <div className="damaged-note">
                              <h4>{text.damagedTitle}</h4>
                              <p>{text.damagedBody}</p>
                            </div>
                            <details className="advanced-disclosure">
                              <summary>{text.advancedTitle}<span className="disclosure-icon" aria-hidden="true"><IconChevronDown /></span></summary>
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
                                <a className="help-source" href="https://help.apple.com/xcode/mac/current/en.lproj/dev9b7736b0e.html">{text.appleCommandLink}<IconExternal /></a>
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
              <a href={`https://github.com/${GITHUB_REPOSITORY}/releases`}>{text.releasesLink}<IconExternal /></a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} text={text} />
    </>
  );
}
