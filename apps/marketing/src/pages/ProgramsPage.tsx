import { Link } from 'react-router-dom'
import SectionHeader from '../components/SectionHeader'
import { siteConfig } from '../config/site'
import { useSeo } from '../lib/seo'

export default function ProgramsPage() {
  useSeo({
    title: 'Programs | Temple Underground',
    description:
      'Temple Underground teaches one integrated combat system that combines BJJ, boxing, wrestling, judo concepts, conditioning, and self-defense.',
    pathname: '/programs',
  })

  return (
    <section className="container-shell py-16 sm:py-20">
      <SectionHeader
        eyebrow="Programs"
        title="One program. One integrated system."
        description="We do not run disconnected tracks. Temple Underground teaches striking, grappling, and conditioning together so athletes become well-rounded and effective in both combat sport and practical self-defense."
      />
      <div className="mt-10 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6 sm:p-8">
        <h3 className="text-2xl font-semibold">Vale Tudo BJJ Program Framework</h3>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-temple-snow/82">
          Our method blends Brazilian Jiu Jitsu, boxing, wrestling, judo-based off-balancing, combat sports conditioning, and combative
          self-defense into one progression path. Every session is coached to connect ranges, improve composure under pressure, and build
          transferable performance.
        </p>
        <div className="mt-6 grid gap-4 text-sm leading-6 text-temple-snow/82 md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-temple-accent">What you'll train</p>
            <p className="mt-2">Striking, clinch, takedown entries, positional control, submissions, and conditioning in one system.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-temple-accent">Why it works</p>
            <p className="mt-2">Integrated rounds improve timing between phases so students avoid gaps between stand-up and ground work.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-temple-accent">Who it's for</p>
            <p className="mt-2">Beginners, active competitors, and adults training for confidence, discipline, and practical readiness.</p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-lg border border-temple-charcoal bg-temple-ink/55 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-temple-accent">Accolades and coaching standard</p>
            <p className="mt-2 text-sm leading-6 text-temple-snow/82">
              Instructors are assessed competent by IBJJF and USA Boxing, with champions and experienced competitors guiding day-to-day
              training and athlete development.
            </p>
          </article>
          <article className="rounded-lg border border-temple-charcoal bg-temple-ink/55 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-temple-accent">Schedule cadence</p>
            <p className="mt-2 text-sm leading-6 text-temple-snow/82">
              Five-day weekly training cadence (Sunday through Thursday) gives members enough frequency to build real skill continuity.
            </p>
          </article>
        </div>
        <Link
          to={siteConfig.cta.primary.href}
          className="focus-ring mt-6 inline-block rounded-md bg-temple-accent px-5 py-3 text-sm font-semibold uppercase tracking-wide text-temple-ink hover:bg-temple-accent/90"
        >
          Book a Trial Class
        </Link>
      </div>
    </section>
  )
}
