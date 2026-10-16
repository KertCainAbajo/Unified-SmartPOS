import logoSvg from '../brand/minimart-logo.svg?raw';

/**
 * The store logo as inline SVG: sharp at any size and uses the page's bundled Poppins font for the wordmark.
 * A 4K PNG export lives in /brand/minimart-logo-4k.png for print and documents.
 */
export function BrandLogo({ className = '' }: { className?: string }) {
  return <div className={`[&>svg]:h-auto [&>svg]:w-full ${className}`} dangerouslySetInnerHTML={{ __html: logoSvg }} />;
}
