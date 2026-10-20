/**
 * Who runs this deployment, for the legal pages. Set in web/.env (see .env.example).
 *
 * Demo mode (the default until VITE_DEMO_MODE=false): the system is a personal/test project. Legal pages say so and use
 * sample rules, the shop shows a "demo store" notice and receipts are marked as not official. Turn it off only after the
 * real business details, BIR permit and policies are in place.
 */
export const platformInfo = {
  legalName: import.meta.env.VITE_PLATFORM_LEGAL_NAME?.trim() ?? '',
  supportEmail: import.meta.env.VITE_PLATFORM_SUPPORT_EMAIL?.trim() ?? '',
  privacyEmail: import.meta.env.VITE_PLATFORM_PRIVACY_EMAIL?.trim() ?? '',
  businessAddress: import.meta.env.VITE_PLATFORM_ADDRESS?.trim() ?? '',
  demo: (import.meta.env.VITE_DEMO_MODE ?? 'true').trim().toLowerCase() !== 'false',
};
