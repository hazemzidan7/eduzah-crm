import { Helmet } from "react-helmet-async";

/**
 * Per-route title + meta description (SPA).
 */
export function Seo({ title, description }) {
  const fullTitle = title.toLowerCase().includes("eduzah") ? title : `${title} | Eduzah`;
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
    </Helmet>
  );
}
