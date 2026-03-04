/**
 * DEPENDENCIES
 * Consumed by: /api/onboarding/route.ts, OnboardingBanner.tsx
 * Consumes: (pure data — no imports)
 * Risk-sensitive: NO (display constants only)
 * Last modified: 2026-03-04
 * Notes: Onboarding step definitions. Completion conditions are evaluated
 *        server-side in /api/onboarding. Field names match prisma/schema.prisma.
 */

export interface OnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  href: string;
  hrefLabel: string;
  required: boolean;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'set_equity',
    order: 1,
    title: 'Set your starting equity',
    description: 'Enter your current account balance so the position sizer and risk calculations are accurate.',
    href: '/settings',
    hrefLabel: 'Go to Account Settings',
    required: true,
    // Condition: User.equity !== 10000 (i.e. changed from the default)
  },
  {
    id: 'connect_t212_invest',
    order: 2,
    title: 'Connect Trading 212 Invest account',
    description: 'Add your Invest API key to enable live position sync and one-click trade execution.',
    href: '/settings',
    hrefLabel: 'Go to Broker Settings',
    required: true,
    // Condition: User.t212Connected === true
  },
  {
    id: 'connect_t212_isa',
    order: 3,
    title: 'Connect Trading 212 ISA account',
    description: 'Add your ISA API key for dual-account support. Required if you hold ISA-eligible positions.',
    href: '/settings',
    hrefLabel: 'Go to Broker Settings',
    required: false,
    // Condition: User.t212IsaConnected === true
  },
  {
    id: 'configure_telegram',
    order: 4,
    title: 'Set up Telegram notifications',
    description: 'Connect your Telegram bot to receive nightly summaries and trade alerts on your phone.',
    href: '/settings',
    hrefLabel: 'Go to Notifications Settings',
    required: false,
    // Condition: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars are both set
  },
  {
    id: 'run_first_scan',
    order: 5,
    title: 'Run your first scan',
    description: 'Scan all tickers to populate candidates, scores, and regime data.',
    href: '/scan',
    hrefLabel: 'Go to Scan',
    required: true,
    // Condition: At least one Scan record exists created within last 7 days
  },
  {
    id: 'schedule_nightly',
    order: 6,
    title: 'Schedule the nightly automation',
    description: 'Register the Windows Task Scheduler job so data refreshes automatically each night.',
    href: '/settings',
    hrefLabel: 'Go to System Settings',
    required: false,
    // Condition: Last Heartbeat record exists and is < 26 hours old
  },
];

export const REQUIRED_STEPS = ONBOARDING_STEPS.filter((s) => s.required);
export const OPTIONAL_STEPS = ONBOARDING_STEPS.filter((s) => !s.required);
