import { CREDIT_PACKS, FOLLOW_UP_COST, LINK_COST, PACK_ORDER, SIGNUP_CREDITS, formatCredits, formatPrice } from '../../shared/types';
import { PRIVACY_HREF, SITE } from '../lib/siteInfo';
import LegalLayout, { type LegalSection } from './LegalLayout';
import { List, Mail } from './legalBits';

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement',
    body: (
      <>
        <p>
          These terms are an agreement between you and {SITE.operator} (“we”, “us”), who runs {SITE.appName}. By creating an account,
          using the service or buying credits, you agree to these terms and to our{' '}
          <a href={PRIVACY_HREF} className="font-medium text-cyan-200 underline decoration-cyan-200/40 underline-offset-4">
            Privacy Policy
          </a>
          . If you don’t agree, please don’t use {SITE.appName}.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'The service',
    body: (
      <p>
        {SITE.appName} reads the customer reviews on product pages you share and writes a summary using AI. We are not connected to, or
        endorsed by, the stores or brands whose pages you share, and their names and trademarks belong to them.
      </p>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: (
      <List
        items={[
          'You must be at least 16 years old, or the age of digital consent where you live if that is lower.',
          'One account is for one person. Keep your sign-in secure, because you’re responsible for what happens in your account.',
          'Give us a real email address so we can reach you about your account and purchases.',
        ]}
      />
    ),
  },
  {
    id: 'credits',
    title: 'Credits',
    body: (
      <>
        <List
          items={[
            `Each product link you add uses ${formatCredits(LINK_COST)} credits, and each follow-up question uses ${formatCredits(FOLLOW_UP_COST)} credits.`,
            'Credits are only used when you get a real result. Blocked pages, errors and pages with no reviews don’t use credits.',
            `New accounts get ${SIGNUP_CREDITS} free credits, once per person.`,
            'Credits don’t expire while the service is running. They have no cash value and can’t be exchanged for money or moved to another account.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'purchases',
    title: 'Buying credit packs',
    body: (
      <>
        <p>Each pack is a one-time payment, in euros, for that pack’s credits:</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {PACK_ORDER.map((id) => (
            <li key={id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
              <span className="font-medium text-ink">{CREDIT_PACKS[id].name}</span>
              <span className="font-mono text-sm">
                {formatPrice(CREDIT_PACKS[id].price)} → {CREDIT_PACKS[id].credits.toLocaleString()} credits
              </span>
            </li>
          ))}
        </ul>
        <List
          items={[
            'You pay on Stripe’s secure checkout page by credit or debit card, Apple Pay, Google Pay or SEPA Direct Debit. We never see or store your full card number or IBAN.',
            'Your credits and tier are added to your account once the payment is confirmed: usually within seconds for cards and wallets, and within 3–5 business days for SEPA Direct Debit. You get a receipt on screen and under Settings → Credits.',
            'Voucher codes (for example from promotions or giveaways) can be redeemed under Add credits. Each works once.',
            'There is no subscription and nothing renews automatically.',
            'Prices may change in the future, but never for a purchase you have already made.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'vouchers',
    title: 'Voucher codes',
    body: (
      <List
        items={[
          'Each code works once. When it’s redeemed, its credits are added to the account that redeemed it.',
          'You can keep a code for yourself or give it to someone else. Treat it like cash: anyone who has it can redeem it, and we can’t replace a code someone else has already used.',
          'Codes can’t be exchanged for money. Reselling codes, or getting them through fraud or stolen payment details, isn’t allowed and the codes may be cancelled.',
        ]}
      />
    ),
  },
  {
    id: 'withdrawal',
    title: 'Refunds and your right of withdrawal',
    body: (
      <>
        <p>
          Credits and voucher codes are digital content delivered immediately once your payment is confirmed. Before you pay, we ask you to agree that they are delivered straight away
          and to confirm that you understand this means you lose the usual 14-day right of withdrawal once it has been delivered.
        </p>
        <List
          items={[
            'If you paid but didn’t receive your credits, or paid twice, contact us and we will fix it or refund you to the card or account you paid with.',
            'If a code you bought hasn’t been redeemed, contact us within 14 days of buying it and we will refund it as a goodwill gesture.',
            'This doesn’t affect any rights you have under the consumer laws of the country where you live.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Fair use',
    body: (
      <>
        <p>Please don’t:</p>
        <List
          items={[
            'use the service for anything illegal, or to harass or harm anyone;',
            'use bots or scripts to use the service, try to get around credit limits, or create extra accounts for free credits;',
            'try to break, overload or get unauthorised access to the service or other people’s data;',
            'copy, resell or offer the service as your own.',
          ]}
        />
        <p>We may suspend accounts that break these rules. Unused purchased credits will be refunded unless the account was used for fraud.</p>
      </>
    ),
  },
  {
    id: 'ai-output',
    title: 'AI summaries',
    body: (
      <p>
        Reports are written by AI from the reviews on the page you share. They can be incomplete or wrong, and they reflect what reviewers
        wrote, not our own opinion. They are not professional, financial, medical or legal advice. Please check anything important against the
        original reviews before you rely on it.
      </p>
    ),
  },
  {
    id: 'content',
    title: 'Your content',
    body: (
      <p>
        You keep any rights you have in the links and questions you enter. You allow us to process them to provide the service, as described
        in the Privacy Policy. You may use the reports you get for personal or business purposes, including the ad ideas.
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes',
    body: (
      <p>
        We work to keep {SITE.appName} running smoothly but can’t promise it will always be available or error-free. We may change or improve
        features. If we ever shut the service down, we’ll give at least 30 days’ notice and refund unused purchased credits.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Our responsibility to you',
    body: (
      <p>
        We are responsible for losses that are a foreseeable result of us breaking these terms or not using reasonable care. Otherwise, and as
        far as the law allows, our total responsibility is limited to the amount you paid us in the 12 months before the problem. Nothing in
        these terms limits responsibility that can’t be limited by law, such as for death or personal injury caused by negligence, or for
        fraud.
      </p>
    ),
  },
  {
    id: 'ending',
    title: 'Closing your account',
    body: (
      <p>
        You can stop using {SITE.appName} at any time and ask us to delete your account by emailing <Mail />. Unused free credits end when the
        account is closed. If you have unused purchased credits, ask us about a refund before closing your account.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. We’ll change the date at the top and, for important changes, tell you in the app or by email before they
        apply. Purchases are always covered by the terms you agreed to when you paid.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Law and disputes',
    body: (
      <p>
        These terms are governed by the law of the country where {SITE.operator} is established. If you are a consumer, you also keep the
        protection of the laws of the country where you live, and you can bring a claim in your local courts. Please contact us first, as most
        problems can be solved quickly.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <p>
        Questions about these terms, a payment or a code? Email <Mail />.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalLayout
      docTitle="Terms and Conditions"
      title="Terms and"
      accent="conditions"
      intro="The rules for using Review Miner and buying credits, written in plain English."
      sections={SECTIONS}
    />
  );
}
