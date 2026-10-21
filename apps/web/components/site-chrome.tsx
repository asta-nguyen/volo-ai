import { IconDownload, IconGithub } from "@/components/icons";
import { GITHUB_REPOSITORY } from "@/lib/releases";
import { copy, type Locale } from "@/lib/site-copy";

type SiteText = (typeof copy)[Locale];
type PageKind = "home" | "features" | "changelog";

const pageSuffix: Record<PageKind, string> = {
  home: "",
  features: "/features",
  changelog: "/changelog",
};

function buildLinks(locale: Locale, text: SiteText, kind: PageKind) {
  const links = [
    kind === "home"
      ? { href: "#about", label: text.aboutLink, current: false }
      : { href: `/${locale}`, label: text.homeLink, current: false },
    kind === "home"
      ? { href: "#downloads", label: text.downloadLink, current: false }
      : { href: `/${locale}#downloads`, label: text.downloadLink, current: false },
    { href: `/${locale}/features`, label: text.featuresLink, current: kind === "features" },
    { href: `/${locale}/changelog`, label: text.changelogLink, current: kind === "changelog" },
  ];
  return links;
}

export function SiteHeader({
  locale,
  text,
  kind = "home",
}: {
  locale: Locale;
  text: SiteText;
  kind?: PageKind;
}) {
  const links = buildLinks(locale, text, kind);
  const homeLabel = locale === "vi" ? "Trang chủ Volo AI" : "Volo AI home";

  return (
    <header className="site-header page-shell">
      <a className="brand" href={`/${locale}`} aria-label={homeLabel}>
        <span className="brand-mark" aria-hidden="true">v</span>
        <span className="brand-name">volo<span>ai</span></span>
      </a>

      <nav className="main-navigation" aria-label={text.navigation}>
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={link.current ? "page" : undefined}>
            {link.label}
          </a>
        ))}
        <a href={`https://github.com/${GITHUB_REPOSITORY}`}>
          <IconGithub />
          GitHub
        </a>
      </nav>

      <div className="header-actions">
        <nav className="language-switch" aria-label={text.languageLabel}>
          <a href={`/en${pageSuffix[kind]}`} lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</a>
          <span aria-hidden="true">/</span>
          <a href={`/vi${pageSuffix[kind]}`} lang="vi" aria-current={locale === "vi" ? "page" : undefined}>VI</a>
        </nav>
        <a className="header-download" href={`/${locale}#downloads`}>
          <IconDownload />
          {text.downloadLink}
        </a>
      </div>

      <nav className="mobile-navigation" aria-label={text.navigation}>
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={link.current ? "page" : undefined}>
            {link.label}
          </a>
        ))}
        <a href={`https://github.com/${GITHUB_REPOSITORY}`}>
          <IconGithub />
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter({ locale, text }: { locale: Locale; text: SiteText }) {
  const homeLabel = locale === "vi" ? "Trang chủ Volo AI" : "Volo AI home";

  return (
    <footer className="site-footer page-shell">
      <a className="brand footer-brand" href={`/${locale}`} aria-label={homeLabel}>
        <span className="brand-mark" aria-hidden="true">v</span>
        <span className="brand-name">volo<span>ai</span></span>
      </a>
      <p>{text.footerText}</p>
      <div className="footer-meta">
        <span>{text.footerNote}</span>
        <a href={`https://github.com/${GITHUB_REPOSITORY}`}>
          <IconGithub />
          GitHub
        </a>
      </div>
    </footer>
  );
}
