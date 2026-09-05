import React from 'react';
import Link from 'next/link';
import { Check, X, Zap, Building2, Crown, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

const plans = [
  {
    name: 'Free',
    tier: 'free',
    price: '$0',
    period: 'forever',
    description: 'Full access to the AI model market intelligence dashboard.',
    icon: Zap,
    color: 'cyan',
    cta: 'Get Started Free',
    ctaLink: '/',
    features: [
      { text: 'Live event feed & changelog', included: true },
      { text: 'All 400+ tracked models', included: true },
      { text: 'Price comparison & arbitrage view', included: true },
      { text: 'Benchmark matrix with custom weights', included: true },
      { text: 'Deals & free tier finder', included: true },
      { text: 'Lab GitHub activity monitor', included: true },
      { text: 'Community & open weights radar', included: true },
      { text: 'Migration cost advisor', included: true },
      { text: 'RSS & JSON feeds', included: true },
      { text: 'Embeddable SVG badges', included: true },
      { text: 'Public REST API (60 req/min)', included: true },
      { text: '5-model watchlist', included: true },
      { text: 'Basic price alerts', included: true },
      { text: 'Price history charts', included: false },
      { text: 'Webhook & email digests', included: false },
      { text: 'Cost optimizer calculator', included: false },
      { text: 'Market anomaly signals', included: false },
      { text: 'API key dashboard', included: false },
      { text: 'Data export', included: false },
    ],
  },
  {
    name: 'Pro',
    tier: 'pro',
    price: '$29',
    period: '/month',
    description: 'Power-user tools for developers who ship with AI.',
    icon: Crown,
    color: 'amber',
    cta: 'Start Pro Trial',
    ctaLink: '/pricing',
    popular: true,
    features: [
      { text: 'Everything in Free', included: true },
      { text: 'Unlimited watchlist models', included: true },
      { text: 'Price history charts & trends', included: true },
      { text: 'Webhook alerts (Slack/Discord)', included: true },
      { text: 'Email digest (daily/weekly)', included: true },
      { text: 'Cost optimizer with cache/batch modeling', included: true },
      { text: 'Full arbitrage analytics', included: true },
      { text: 'Market anomaly signals', included: true },
      { text: 'API key management dashboard', included: true },
      { text: 'Advanced search & filters', included: true },
      { text: 'Full data export (GDPR)', included: true },
      { text: 'Custom badge branding', included: true },
      { text: 'Priority API quota (300 req/min)', included: true },
      { text: 'Real-time stream', included: false },
      { text: 'Custom webhooks', included: false },
      { text: 'Team workspaces', included: false },
      { text: 'SLA monitoring', included: false },
      { text: 'White-label badges', included: false },
      { text: 'Priority support', included: false },
    ],
  },
  {
    name: 'Enterprise',
    tier: 'enterprise',
    price: '$199',
    period: '/month',
    description: 'Real-time intelligence for teams building production AI systems.',
    icon: Building2,
    color: 'purple',
    cta: 'Contact Sales',
    ctaLink: '/contact',
    features: [
      { text: 'Everything in Pro', included: true },
      { text: 'Real-time SSE/WebSocket stream', included: true },
      { text: 'Custom webhook configurations', included: true },
      { text: 'Team workspaces & shared alerts', included: true },
      { text: 'SLA monitoring & uptime guarantees', included: true },
      { text: 'Bulk API access (1,200 req/min)', included: true },
      { text: 'White-label embeddable badges', included: true },
      { text: 'Priority support channel', included: true },
      { text: 'Dedicated Slack/Discord support', included: true },
      { text: '99.9% uptime SLA', included: true },
    ],
  },
];

const comparisonRows = [
  {
    category: 'Market Intelligence',
    features: [
      { label: 'Live event feed', free: true, pro: true, enterprise: true },
      { label: 'Monthly changelogs', free: true, pro: true, enterprise: true },
      { label: 'Market anomaly signals', free: 'Last 5', pro: 'Full history', enterprise: 'Full + custom' },
      { label: 'Lab GitHub activity', free: true, pro: true, enterprise: true },
      { label: 'Community radar (HuggingFace)', free: true, pro: true, enterprise: true },
    ],
  },
  {
    category: 'Pricing & Analysis',
    features: [
      { label: 'Model price comparison', free: true, pro: true, enterprise: true },
      { label: 'Multi-provider arbitrage', free: 'Basic view', pro: 'Full analytics', enterprise: 'Full + historical' },
      { label: 'Price history charts', free: false, pro: true, enterprise: true },
      { label: 'Benchmark matrix', free: '7 models', pro: 'Custom weights', enterprise: 'Custom + export' },
      { label: 'Migration cost advisor', free: '3 recommendations', pro: 'Full calculator', enterprise: 'Team budgets' },
    ],
  },
  {
    category: 'Alerts & Automation',
    features: [
      { label: 'Basic price alerts', free: '5 rules', pro: 'Unlimited', enterprise: 'Unlimited' },
      { label: 'Webhook alerts (Slack/Discord)', free: false, pro: true, enterprise: true },
      { label: 'Email digests (daily/weekly)', free: false, pro: true, enterprise: true },
      { label: 'Compound alert conditions', free: false, pro: true, enterprise: true },
      { label: 'Real-time event stream (SSE)', free: false, pro: false, enterprise: true },
      { label: 'Custom webhook configs', free: false, pro: false, enterprise: true },
    ],
  },
  {
    category: 'Developer Tools',
    features: [
      { label: 'Public REST API', free: '60 req/min', pro: '300 req/min', enterprise: '1,200 req/min' },
      { label: 'RSS & JSON feeds', free: true, pro: true, enterprise: true },
      { label: 'Embeddable SVG badges', free: 'Basic', pro: 'Custom branding', enterprise: 'White-label' },
      { label: 'API key dashboard', free: false, pro: true, enterprise: true },
      { label: 'Data export (GDPR)', free: false, pro: true, enterprise: true },
    ],
  },
  {
    category: 'Team & Support',
    features: [
      { label: 'Watchlist models', free: '5 max', pro: 'Unlimited', enterprise: 'Unlimited + shared' },
      { label: 'Team workspaces', free: false, pro: false, enterprise: true },
      { label: 'Support channel', free: 'GitHub Issues', pro: 'Email', enterprise: 'Slack/Discord' },
      { label: 'SLA guarantee', free: false, pro: false, enterprise: '99.9%' },
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-mono">
          <Zap className="w-3.5 h-3.5" />
          <span>PRICING</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
          Market Intelligence for AI Developers
        </h1>
        <p className="max-w-2xl mx-auto text-gray-400 text-sm sm:text-base">
          Track every price drop, new release, and arbitrage opportunity across 400+ AI models.
          Start free, upgrade when you need power-user tools.
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isPro = plan.tier === 'pro';
          return (
            <div
              key={plan.tier}
              className={`relative rounded-2xl border p-6 space-y-5 ${
                isPro
                  ? 'border-amber-500/40 bg-[#111827] shadow-lg shadow-amber-950/20'
                  : 'border-gray-800 bg-[#111827]/80'
              }`}
            >
              {isPro && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold uppercase tracking-wider">
                  Most Popular
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isPro ? 'bg-amber-950/60 text-amber-400' : 'bg-cyan-950/60 text-cyan-400'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-sm text-gray-400">{plan.period}</span>
                </div>
                <p className="text-xs text-gray-400">{plan.description}</p>
              </div>

              <Link
                href={plan.ctaLink}
                className={`block w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isPro
                    ? 'bg-amber-500 hover:bg-amber-400 text-black'
                    : plan.tier === 'enterprise'
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                }`}
              >
                {plan.cta}
              </Link>

              <ul className="space-y-2 pt-2">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {f.included ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-gray-600 mt-0.5 shrink-0" />
                    )}
                    <span className={f.included ? 'text-gray-300' : 'text-gray-600'}>{f.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-extrabold text-white">Full Feature Comparison</h2>
          <p className="text-sm text-gray-400 mt-1">Every feature, every tier, side by side.</p>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-[#111827]/80 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="py-3 px-4 font-mono text-gray-400 w-1/3">Feature</th>
                  <th className="py-3 px-4 font-mono text-cyan-400 text-center">Free</th>
                  <th className="py-3 px-4 font-mono text-amber-400 text-center">Pro</th>
                  <th className="py-3 px-4 font-mono text-purple-400 text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {comparisonRows.map((section) => (
                  <React.Fragment key={section.category}>
                    <tr className="bg-gray-900/40">
                      <td colSpan={4} className="py-2 px-4 font-mono font-bold text-gray-300 text-[11px] uppercase tracking-wider">
                        {section.category}
                      </td>
                    </tr>
                    {section.features.map((row) => (
                      <tr key={row.label} className="hover:bg-gray-800/30 transition-colors">
                        <td className="py-2.5 px-4 text-gray-300">{row.label}</td>
                        {(['free', 'pro', 'enterprise'] as const).map((tier) => {
                          const val = row[tier];
                          return (
                            <td key={tier} className="py-2.5 px-4 text-center">
                              {typeof val === 'boolean' ? (
                                val ? (
                                  <Check className="w-4 h-4 text-emerald-400 mx-auto" />
                                ) : (
                                  <X className="w-4 h-4 text-gray-600 mx-auto" />
                                )
                              ) : (
                                <span className="text-gray-300 font-mono text-[11px]">{val}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-2xl font-extrabold text-white text-center">Frequently Asked Questions</h2>
        {[
          {
            q: 'Is the free tier really free?',
            a: 'Yes. The free tier includes full access to the dashboard, event feed, model listing, price comparison, benchmarks, deals, labs activity, community radar, changelogs, RSS/JSON feeds, SVG badges, and the public API at 60 req/min. No credit card required.',
          },
          {
            q: 'Can I try Pro before paying?',
            a: 'Pro features are available behind feature flags. When Stripe billing is enabled, you can start a Pro subscription and cancel anytime. All features are immediately accessible.',
          },
          {
            q: 'What happens to my data if I downgrade?',
            a: 'Your watchlists, alert rules, and account data are preserved. Features behind higher tiers become read-only until you re-upgrade.',
          },
          {
            q: 'Do you support annual billing?',
            a: 'Annual billing is coming soon with a 20% discount. Enterprise plans include custom pricing — contact sales.',
          },
          {
            q: 'How is this different from OpenRouter or other pricing tools?',
            a: 'AI Model Radar is an event-sourced market changelog, not a pricing table. We track every price drop, new release, free tier change, and context expansion in real time, with anomaly detection, multi-provider arbitrage, and cost optimization tools.',
          },
        ].map((faq) => (
          <div key={faq.q} className="rounded-xl border border-gray-800 bg-[#111827]/60 p-5 space-y-2">
            <h3 className="text-sm font-bold text-white">{faq.q}</h3>
            <p className="text-xs text-gray-400 leading-relaxed">{faq.a}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="text-center space-y-4 py-8">
        <h2 className="text-2xl font-extrabold text-white">Start tracking the AI model market today.</h2>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors"
          >
            Explore Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold border border-gray-700 transition-colors"
          >
            API Documentation
          </Link>
        </div>
      </div>
    </div>
  );
}
