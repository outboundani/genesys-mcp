// Plan definitions and gates. `comp` is an admin-granted courtesy plan with
// scale limits and no Stripe subscription behind it.

export const PLANS = {
  free: {
    label: 'free',
    price: 0,
    projects: 1,
    generations_per_month: 3,
    tool_calls_per_month: 300,
    export: false,
  },
  pro: {
    label: 'pro',
    price: 29,
    projects: 10,
    generations_per_month: 25,
    tool_calls_per_month: 10000,
    export: true,
  },
  scale: {
    label: 'scale',
    price: 99,
    projects: 50,
    generations_per_month: 100,
    tool_calls_per_month: 100000,
    export: true,
  },
  comp: {
    label: 'comp',
    price: 0,
    projects: 50,
    generations_per_month: 100,
    tool_calls_per_month: 100000,
    export: true,
  },
};

export function planFor(user) {
  // A lapsed paid plan (subscription canceled/unpaid) falls back to free limits.
  const plan = PLANS[user?.plan] || PLANS.free;
  if ((user?.plan === 'pro' || user?.plan === 'scale') &&
      user.plan_status && !['active', 'trialing', 'past_due'].includes(user.plan_status)) {
    return PLANS.free;
  }
  return plan;
}

export function planIdForPrice(env, priceId) {
  if (priceId && priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId && priceId === env.STRIPE_PRICE_SCALE) return 'scale';
  return null;
}
