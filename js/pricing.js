// pricing.js — pure pricing + price-split logic (no DOM, no storage), so it
// can be tested on its own. Defaults come straight from the
// "Video Crew Pricing System 2026" PDF; every value is editable in the app
// and saved through storage.js (getPricing / savePricing).

const FEAT = ['Professional videography', 'Professional editing', 'Content planning'];
export const DEFAULT_PACKAGES = [
  { id: 'starter', name: 'Starter', reels: 4, sessions: 2, price: 3000, popular: false, features: ['2 shooting sessions / month | 1 time per week', ...FEAT] },
  { id: 'growth', name: 'Growth', reels: 8, sessions: 4, price: 6000, popular: true, features: ['4 shooting sessions / month | 1 time per week', ...FEAT, 'Instagram management'] },
  { id: 'premium', name: 'Premium', reels: 12, sessions: 4, price: 10000, popular: false, features: ['4 shooting sessions / month | 1 time per week', ...FEAT, 'Instagram management'] },
];

export const DEFAULT_PRICING = {
  base: 2000,
  baseHours: 5,
  baseReels: 1,
  baseCrew: 2,
  baseDeliveryText: 'within 48 hours',
  sizes: { small: 0, medium: 500, large: 1000 },
  extraReel: 300,
  extraHour: 500,
  extraLocation: 500,
  perKm: 10,
  delivery: { normal: 0, fast: 20, sameDay: 50 }, // surcharge %
  crew: 2,
  business: {
    name: 'Frame Flicks',
    phone: '',
    upi: '',
    footer: 'Thank you for choosing Frame Flicks',
    payNote: 'Balance due on delivery.',
    monthlyTag: 'Instagram content made simple',
    monthlyPayNote: 'Your shoot slots are confirmed once payment is received.',
    monthlyTerms: 'Package covers one calendar month.\nUnused reels do not carry over.\nExtra reels are billed at the quoted rate.',
    monthlyFooter: "Let's grow your business on Instagram",
    terms: 'An advance confirms your date.\nExtra hours are billed at the quoted hourly rate.\nRaw footage is not included.',
  },
  distribution: [
    { key: 'labour', label: 'Labour', pct: 40, note: 'Crew compensation' },
    { key: 'editing', label: 'Editing', pct: 25, note: 'Editing and production work' },
    { key: 'business', label: 'Business', pct: 20, note: 'Profit, reserve and growth' },
    { key: 'referral', label: 'Referral commission', pct: 5, note: 'Paid only when someone brings the client', referral: true },
    { key: 'travel', label: 'Travel', pct: 5, note: 'Travel and transportation' },
    { key: 'subscriptions', label: 'Subscriptions', pct: 5, note: 'Software, AI, music, cloud, etc.' },
  ],
};

export const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
export const SIZE_EXAMPLES = {
  small: 'Birthday, small gathering, private function',
  medium: 'Medium wedding, college function, stage event',
  large: 'Large wedding, festival, corporate event',
};
export const DELIVERY_LABELS = {
  normal: 'Normal (within 48 hours)',
  fast: 'Fast (within 24 hours)',
  sameDay: 'Same day',
};

const num = (v) => Math.max(0, Number(v) || 0);

// Fills any missing value in saved data from the defaults, so adding a new
// setting later never breaks an older saved copy.
export function mergePricing(saved) {
  const d = DEFAULT_PRICING;
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = { ...d, ...s };
  out.sizes = { ...d.sizes, ...(s.sizes || {}) };
  out.delivery = { ...d.delivery, ...(s.delivery || {}) };
  out.business = { ...d.business, ...(s.business || {}) };
  out.distribution = Array.isArray(s.distribution) && s.distribution.length
    ? s.distribution.map((row) => ({ ...row }))
    : d.distribution.map((row) => ({ ...row }));
  out.packages = (Array.isArray(s.packages) && s.packages.length ? s.packages : DEFAULT_PACKAGES).map((x) => ({ ...x, features: [...(x.features || [])] }));
  return out;
}

// Add-ons you can add to an invoice. "quote" ones start at ₹0 because the PDF
// says to quote them separately — type the price on the invoice line.
export function addOnCatalog(p) {
  return [
    { key: 'reel', label: 'Extra reel', unit: 'reel', rate: p.extraReel },
    { key: 'hour', label: 'Extra shooting hour', unit: 'hour', rate: p.extraHour },
    { key: 'location', label: 'Extra location', unit: 'location', rate: p.extraLocation },
    { key: 'travel', label: 'Extra / distant travel', unit: 'km', rate: p.perKm },
    { key: 'drone', label: 'Drone coverage', unit: '', rate: 0, quote: true },
    { key: 'vfx', label: 'Advanced VFX', unit: '', rate: 0, quote: true },
    { key: 'longform', label: 'Long-form video', unit: '', rate: 0, quote: true },
    { key: 'custom', label: 'Custom item', unit: '', rate: 0, quote: true },
  ];
}

// Final client price = (base + function size + add-ons) + delivery surcharge %
export function calcInvoice({ pricing, size, delivery, lines, discount, advance }) {
  const base = num(pricing.base);
  const sizeAmt = num(pricing.sizes[size]);
  const lineRows = (lines || []).map((l) => ({ ...l, amount: num(l.qty) * num(l.rate) }));
  const addOns = lineRows.reduce((s, l) => s + l.amount, 0);
  const subtotal = base + sizeAmt + addOns;
  const pct = num(pricing.delivery[delivery]);
  const surcharge = Math.round((subtotal * pct) / 100);
  const total = subtotal + surcharge;
  const disc = Math.min(num(discount), total);
  const grand = total - disc;
  const paid = Math.min(num(advance), grand);
  return { base, sizeAmt, lineRows, addOns, subtotal, pct, surcharge, total, discount: disc, grand, advance: paid, balance: grand - paid };
}

// Splits a project price using the editable percentages. If the client did
// NOT come through a referral, the referral % stays with the business (per
// the PDF). Any rounding drift (a rupee or two) is added to Business so the
// rows always add up to the exact total.
export function splitPrice(total, distribution, { referral = false, crew = 2 } = {}) {
  const amount = Math.round(num(total));
  const rows = distribution.map((d) => ({
    ...d,
    effectivePct: d.referral && !referral ? 0 : num(d.pct),
    amount: 0,
    unused: !!(d.referral && !referral),
  }));
  const unusedPct = distribution.filter((d) => d.referral && !referral).reduce((s, d) => s + num(d.pct), 0);
  const biz = rows.find((r) => r.key === 'business') || rows[rows.length - 1];
  if (biz) biz.effectivePct += unusedPct;

  rows.forEach((r) => { r.amount = Math.round((amount * r.effectivePct) / 100); });
  const pctTotal = distribution.reduce((s, d) => s + num(d.pct), 0);
  const allocated = rows.reduce((s, r) => s + r.amount, 0);
  let unallocated = amount - allocated;
  if (Math.abs(pctTotal - 100) < 0.001 && biz) {
    biz.amount += unallocated; // rounding drift only
    unallocated = 0;
  }
  const people = Math.max(1, Math.round(num(crew)) || 1);
  rows.forEach((r) => { if (r.key === 'labour') r.perPerson = Math.round(r.amount / people); });
  return { total: amount, rows, pctTotal, unallocated, people };
}
