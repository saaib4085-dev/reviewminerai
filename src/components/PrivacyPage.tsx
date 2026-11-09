import { SITE } from '../lib/siteInfo';
import LegalLayout, { type LegalSection } from './LegalLayout';
import { Ext, List, Mail } from './legalBits';

const SECTIONS: LegalSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    body: (
      <>
        <p>
          {SITE.appName} (“we”, “us”){SITE.operator !== SITE.appName ? `, operated by ${SITE.operator},` : ''} reads the customer reviews on a
          product page you share and gives you a plain-English summary. This policy explains what information we collect when you use {SITE.appName}, why we collect it,
          who we share it with, and the choices you have.
        </p>
        <p>We keep the information we collect to what the service needs. We do not sell your personal information, and we do not show ads.</p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'Information we collect',
    body: (
      <>
        <h3>Account information</h3>
        <p>
          When you sign up with Google, Google shares your name, email address and profile picture with us. When you sign up with email, we
          receive your email address. We use your email address to identify your account. We do not ask for or receive your Google password.
        </p>
        <h3>What you enter</h3>
        <List
          items={[
            'Product links you paste and the questions you ask.',
            'The topics you choose and your settings, such as quick or detailed reports.',
            'If you use the microphone button, your browser turns your speech into text. We receive only the text, never the audio.',
          ]}
        />
        <h3>What the service creates</h3>
        <List
          items={[
            'The reports and answers generated for you.',
            'The text of the product pages you share, which we store so we can answer your follow-up questions about that product.',
          ]}
        />
        <h3>Credits and payments</h3>
        <p>
          We keep a record of your credit balance, every credit added or used, and your orders (pack, amount, payment reference and dates).
          Payments are handled by Stripe. We receive the name you enter, the type of payment, the last 4 digits of your card or IBAN, the amount
          and a payment ID, which appear on your receipt. We never receive or store your full card number, CVC or IBAN. We keep payment
          records as long as accounting and tax rules require.
        </p>
        <h3>Technical information</h3>
        <p>
          Like most websites, our hosting provider automatically processes technical data such as your IP address, browser type and the time
          of your visit, to deliver the site and keep it secure.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use your information',
    body: (
      <List
        items={[
          'To create and run your account and keep you signed in.',
          'To read the product pages you share and generate your reports and answers.',
          'To keep track of your credits and process your purchases.',
          'To show your past chats and remember your settings.',
          'To keep the service secure, prevent abuse and fix problems.',
          'To reply when you contact us.',
        ]}
      />
    ),
  },
  {
    id: 'google',
    title: 'Information from Google',
    body: (
      <>
        <p>
          If you sign in with Google, we request only basic sign-in access (your name, email address and profile picture). We use it only to
          create your account and sign you in. We do not use it for advertising, we do not sell it, and we do not use it to train AI models.
        </p>
        <p className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.07] p-4 text-ink">
          {SITE.appName}’s use and transfer of information received from Google APIs to any other app will adhere to the{' '}
          <Ext href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</Ext>, including the
          Limited Use requirements.
        </p>
        <p>
          You can remove {SITE.appName}’s access to your Google account at any time at{' '}
          <Ext href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</Ext>.
        </p>
      </>
    ),
  },
  {
    id: 'providers',
    title: 'Who we share it with',
    body: (
      <>
        <p>We share information only with the companies that help us run {SITE.appName}, and only what each one needs:</p>
        <List
          items={[
            <><strong>Supabase</strong>: stores your account, chats, reports, settings and credit records, and handles sign-in.</>,
            <><strong>Cloudflare</strong>: hosts the website and runs our servers.</>,
            <><strong>Anthropic</strong>: the AI that writes your reports. It receives the product link, your question and the product page text, and searches the public web for reviews of that product.</>,
            <><strong>Firecrawl</strong>: opens the product pages you share and returns their text. It receives the page link.</>,
            <><strong>Stripe</strong>: processes card, Apple Pay, Google Pay and SEPA Direct Debit payments. Your payment details go straight to Stripe and are covered by Stripe’s privacy policy.</>,
            <><strong>Google</strong>: provides “Sign in with Google” and the fonts used on this site.</>,
          ]}
        />
        <p>
          We may also share information if the law requires it, to protect the rights and safety of our users or the public, or as part of a sale
          or merger of the business, in which case this policy would continue to protect your information.
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'AI processing',
    body: (
      <p>
        Reports and answers are written by an AI model using the product page you share, your question, and public reviews it finds with web search. We do not use your content to
        train AI models. AI summaries can contain mistakes, so please check anything important against the original reviews.
      </p>
    ),
  },
  {
    id: 'storage',
    title: 'Cookies and browser storage',
    body: (
      <p>
        We don’t use advertising or tracking cookies. We use your browser’s storage to keep you signed in, and briefly to remember a product link
        you typed before signing up.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <List
        items={[
          'Your account and settings: until you delete your account.',
          <>Your chats and reports: until you delete them. You can close a chat or delete all chats any time in <strong>Settings → Account</strong>.</>,
          'Payment and credit records: as long as needed for accounting and tax rules.',
          'Technical logs: kept by our providers for a short time for security.',
        ]}
      />
    ),
  },
  {
    id: 'rights',
    title: 'Your choices and rights',
    body: (
      <>
        <p>
          You can ask us to access, correct, export or delete your personal information, or object to how we use it. To delete your account
          and everything in it, email <Mail /> from the address you signed up with. We’ll reply within 30 days.
        </p>
        <p>
          Depending on where you live (for example the EU, UK or California), you may have additional rights under local law, including the right
          to complain to your data protection authority. We do not sell or “share” personal information for advertising.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        Information is encrypted in transit, and access to your data is restricted so each account can only see its own chats and credits.
        No online service can be completely secure, but we work to protect your information and will let you know if a breach affects you,
        as the law requires.
      </p>
    ),
  },
  {
    id: 'transfers',
    title: 'International transfers',
    body: (
      <p>
        Our providers may process information in countries other than yours, including the United States. Where required, they use standard
        legal safeguards for these transfers.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        {SITE.appName} is not meant for children under 13 (or under 16 where local law requires), and we don’t knowingly collect their
        information. If you think a child has given us information, contact us and we’ll delete it.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We may update this policy from time to time. We’ll change the date at the top, and if the changes are significant we’ll let you know
        in the app or by email.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <p>
        Questions about this policy or your information? Email <Mail />.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalLayout
      docTitle="Privacy Policy"
      title="Privacy"
      accent="policy"
      intro="What we collect, why, and the choices you have, written in plain English."
      sections={SECTIONS}
    />
  );
}
