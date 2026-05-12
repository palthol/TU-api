export const siteConfig = {
  business: {
    name: 'Temple Underground',
    shortTagline: 'Brazilian Jiu Jitsu, Boxing, Combative Self-Defense.',
    phone: '(555) 214-9000',
    email: 'hello@templeunderground.com',
    addressLine1: 'Morristown Training Area',
    cityStateZip: 'Morristown, Tennessee',
    mapUrl: 'https://maps.google.com',
    websiteUrl: 'https://templeunderground.example.com',
  },
  cta: {
    primary: {
      label: 'Book a Trial Class',
      href: '/contact',
    },
    secondary: {
      label: 'View Schedule',
      href: '/schedule-pricing',
    },
    stickyMobileLabel: 'Start Your Trial',
  },
  socials: {
    instagram: 'https://instagram.com/templeunderground',
    youtube: 'https://youtube.com/@templeunderground',
    facebook: 'https://facebook.com/templeunderground',
  },
  schedule: {
    weekdays: [
      { label: 'Morning Training', time: '7:00 AM - 9:00 AM' },
      { label: 'Afternoon Training', time: '4:00 PM - 6:00 PM' },
      { label: 'Evening Training', time: '7:00 PM - 9:00 PM' },
    ],
    sunday: [{ label: 'Open Mat (Self-Directed)', time: '3:00 PM' }],
    trainingWindowNote:
      'On some days, afternoon and evening groups merge into a coaching window from 4:00 PM - 7:00 PM. Members can start inside that window and still complete a full 2-hour training block.',
  },
  pricing: {
    dropIn: '$20 / class',
    monthly: [
      {
        tier: '$100',
        label: 'Foundation',
        detail: 'Best for 1-2 classes per week and steady fundamentals.',
      },
      {
        tier: '$150',
        label: 'Momentum',
        detail: 'For 2-4 sessions weekly with balanced skill and conditioning.',
      },
      {
        tier: '$200',
        label: 'Performance',
        detail: 'For committed athletes training 4+ sessions with coaching depth.',
      },
    ],
    privateAddOns: [
      { tier: '$150', detail: 'Technical tune-up sessions' },
      { tier: '$200', detail: 'Performance-focused private blocks' },
      { tier: '$250', detail: 'Competition prep and game-plan review' },
    ],
    familyNote: 'Ask about family plans and sibling scheduling support.',
  },
  seo: {
    defaultTitle: 'Temple Underground | BJJ, Boxing, and Combative Self-Defense',
    defaultDescription:
      'Morristown, Tennessee combat sports academy teaching striking and grappling as one system for combat sport, combative self-defense, and conditioning.',
    ogImage: '/og-temple-underground.jpg',
  },
} as const

export type SiteConfig = typeof siteConfig
