import type { Analysis, Report } from '../../shared/types';

// A made-up product used on the home page showcase (and in the preview build).
export const sampleReport: Report = {
  product_name: 'Brightline Cordless Kettle 1.7L',
  verdict:
    'Most buyers love how fast it boils and how easy it is to pour. The main gripes are a lid that sticks after a few months and a plastic smell for the first week. It’s seen as good value, especially for tea drinkers.',
  average_rating: 4.4,
  review_count: 2318,
  sentiment: { positive: 74, neutral: 14, negative: 12 },
  love: [
    { theme: 'Boils really fast', detail: 'People say it boils a full kettle in about three minutes.', frequency: 'many', quote: 'Faster than my old one by a mile, tea in no time.' },
    { theme: 'Easy to pour', detail: 'The spout doesn’t drip, even when the kettle is full.', frequency: 'many', quote: 'No more puddles on the counter.' },
    { theme: 'Temperature settings', detail: 'Tea and coffee fans like picking an exact temperature.', frequency: 'some', quote: null },
  ],
  complaints: [
    { theme: 'Lid starts sticking', detail: 'After a few months the lid button can get stiff.', frequency: 'some', quote: 'Lid button is getting harder to press.' },
    { theme: 'Plastic smell at first', detail: 'A smell that fades after boiling water a few times.', frequency: 'some', quote: null },
    { theme: 'Loud beep', detail: 'The finished beep can’t be turned off.', frequency: 'few', quote: 'The beep wakes the whole house.' },
  ],
  wishes: [
    { idea: 'Option to mute the beep', detail: 'Early risers want a quiet mode.' },
    { idea: 'Keep-warm for longer', detail: 'It keeps water warm for 30 minutes, people want an hour.' },
  ],
  buyers: [
    { type: 'Tea lovers', why: 'They want exact temperatures for green and white tea.' },
    { type: 'Pour-over coffee fans', why: 'The thin spout gives them control.' },
  ],
  ads: [
    { headline: 'Tea in three minutes flat', body: 'Thousands of buyers say it’s the fastest kettle they’ve owned. Pick your exact temperature and pour without a drip.' },
    { headline: 'The right heat for every cup', body: 'Green tea, black tea or pour-over coffee: set it once and get it right every time.' },
    { headline: 'No drips. No puddles.', body: 'Reviewers keep mentioning the spout. Pour a full kettle cleanly, every single time.' },
  ],
  answer:
    'Mostly yes. Buyers with small kitchens say the cordless base takes little counter space and it fits under low cabinets. A few say the base is wider than they expected, so measure first if your counter is very narrow.',
  data_quality: 'good',
  data_note: 'Based on about 2,300 reviews shown on the page.',
};

export const sampleAnalysis: Analysis = {
  id: 'sample',
  group_id: null,
  url: 'https://www.example-store.com/products/brightline-kettle',
  product_name: sampleReport.product_name,
  focuses: ['love', 'complaints', 'wishes', 'buyers', 'ads'],
  question: 'Is it worth it for a small kitchen?',
  report: sampleReport,
  created_at: new Date().toISOString(),
};
