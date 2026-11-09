// Details shown on the Privacy Policy. Set these in Cloudflare Pages
// (Settings → Variables) so you don't need to edit code, then redeploy.
export const SITE = {
  appName: 'Review Miner',
  operator: import.meta.env.VITE_OPERATOR_NAME || 'Review Miner',
  contactEmail: import.meta.env.VITE_CONTACT_EMAIL || 'privacy@yourdomain.com',
  lastUpdated: 'November 8, 2026',
};

// Links between pages. The preview build swaps these for #hash links.
export const PRIVACY_HREF = import.meta.env.VITE_PRIVACY_HREF || '/privacy';
export const TERMS_HREF = import.meta.env.VITE_TERMS_HREF || '/terms';
export const ADMIN_HREF = import.meta.env.VITE_ADMIN_HREF || '/admin';
export const HOME_HREF = import.meta.env.VITE_HOME_HREF || '/';
