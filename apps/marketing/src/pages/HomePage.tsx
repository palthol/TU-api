import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import ExperienceToSystemSection from '../components/ExperienceToSystemSection'
import FAQAccordion from '../components/FAQAccordion'
import SectionHeader from '../components/SectionHeader'
import TestimonialCard from '../components/TestimonialCard'
import { siteConfig } from '../config/site'
import { useSeo } from '../lib/seo'

const faqs = [
  {
    question: 'Do I need experience to start?',
    answer:
      'No. Beginners are coached every session with clear structure, partner guidance, and progressions that match where you are today.',
  },
  {
    question: 'Is training only for competitors?',
    answer:
      'Competition is one path, not the only one. Many members train for confidence, resilience, and self-defense while still learning the same integrated combat system.',
  },
  {
    question: 'How does conditioning fit in?',
    answer:
      'Combat conditioning supports your striking and grappling—it is not separate “random hard workouts.” Breath, mobility, and durability are trained so they transfer to real movement.',
  },
]

export default function HomePage() {
  useSeo({
    title: 'Temple Underground | Vale Tudo-style Jiu-Jitsu & Integrated Combat Training',
    description:
      'Morristown, Tennessee academy teaching Vale Tudo-style Jiu-Jitsu: striking, grappling, and combat conditioning as one integrated combat system.',
    pathname: '/',
  })

  return (
    <>
      <section className="relative overflow-hidden border-b border-temple-charcoal bg-hero-glow">
        <div className="container-shell py-16 text-center sm:py-24">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-sm font-semibold uppercase tracking-[0.16em] text-temple-accent"
          >
            Morristown, Tennessee
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="hero-wordmark mt-4"
            aria-label="Temple Underground"
            role="img"
          >
            <h1 className="hero-wordmark-top">Temple</h1>
            <div className="hero-wordmark-bottom-row">
              <span className="hero-wordmark-line" aria-hidden="true" />
              <p className="hero-wordmark-bottom">Underground</p>
              <span className="hero-wordmark-line" aria-hidden="true" />
            </div>
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-temple-snow/90 sm:text-lg sm:leading-8"
          >
            Temple Underground teaches{' '}
            <span className="font-semibold text-temple-accent">Vale Tudo-style Jiu-Jitsu</span>
            —striking, grappling, and combat conditioning—as one integrated combat system for the purpose of self-defense, competition, and
            self-improvement.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="mx-auto mt-4 max-w-xl text-xs font-medium uppercase tracking-[0.14em] text-temple-snow/65 sm:text-sm"
          >
            We have classes Sunday through Thursday
          </motion.p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              to={siteConfig.cta.primary.href}
              className="focus-ring rounded-md bg-temple-accent px-5 py-3 text-sm font-semibold uppercase tracking-wide text-temple-ink hover:bg-temple-accent/90"
            >
              {siteConfig.cta.primary.label}
            </Link>
            <Link
              to={siteConfig.cta.secondary.href}
              className="focus-ring rounded-md border border-temple-accent/65 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-temple-accent hover:bg-temple-accent/10"
            >
              {siteConfig.cta.secondary.label}
            </Link>
          </div>
        </div>
      </section>

      <ExperienceToSystemSection />

      <section className="border-t border-temple-charcoal/60 bg-temple-charcoal/15">
        <div className="container-shell py-16 sm:py-20">
          <SectionHeader
            eyebrow="Combat conditioning"
            title="Fitness that supports fighting—not noise for its own sake"
            description="Conditioning is the physical development side of the same system: we build strength, mobility, and durability so striking and grappling hold up under real stress."
          />

          <div className="mx-auto mt-8 max-w-3xl space-y-4 text-sm leading-7 text-temple-snow/82 sm:text-[15px] sm:leading-7">
            <p>
              We train across <span className="key-phrase">isometric</span>, <span className="key-phrase">isokinetic</span>,{' '}
              <span className="key-phrase">eccentric</span>, <span className="key-phrase">plyometric</span>, and{' '}
              <span className="key-phrase">anaerobic</span> qualities. The emphasis stays on{' '}
              <span className="key-phrase">isometrics</span> and <span className="key-phrase">targeted plyometrics</span> so power shows up
              where you actually need it—not as random fatigue for its own sake.
            </p>
            <p>
              Most work is <span className="key-phrase">bodyweight-first</span> so sessions stay scalable across levels. The facility also
              has <span className="key-phrase">Olympic barbells and plates</span> when loaded work fits the progression. Day to day, we
              prioritize <span className="key-phrase">calisthenics</span> and <span className="key-phrase">isometric conditioning</span>{' '}
              over everything else.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-temple-charcoal bg-temple-ink/60 p-5 sm:p-6">
              <p className="info-chip">Breathing</p>
              <p className="mt-3 text-sm leading-7 text-temple-snow/82">
                Breathing is treated as its own continuous skill: it stays deliberate whenever effort spikes, and it runs through all of
                combat conditioning the same way it has to run while you <span className="key-phrase">strike</span> and{' '}
                <span className="key-phrase">grapple</span>. If breath is unfocused, the work stops transferring—so we keep it central,
                not optional.
              </p>
            </div>
            <div className="rounded-xl border border-temple-charcoal bg-temple-ink/60 p-5 sm:p-6">
              <p className="info-chip">Strength & structure</p>
              <p className="mt-3 text-sm leading-7 text-temple-snow/82">
                For a base of strength and <span className="key-phrase">relative strength</span>, we lean on isometrics: stabilize
                positions for time, prioritize <span className="key-phrase">functional postures</span> that resemble grappling shapes, and
                build the kind of structure you use to manage frames and distance—so conditioning reinforces the positions you fight from,
                not generic gym poses.
              </p>
            </div>
            <div className="rounded-xl border border-temple-charcoal bg-temple-ink/60 p-5 sm:p-6 lg:col-span-2">
              <p className="info-chip">Mobility, proprioception & coordination</p>
              <p className="mt-3 text-sm leading-7 text-temple-snow/82">
                To support mobility, body awareness, and coordination, <span className="key-phrase">yoga</span>,{' '}
                <span className="key-phrase">shadowboxing</span>, and <span className="key-phrase">shadow wrestling</span> stay core
                activities—simple on paper, demanding in practice—because they connect timing, eyes, feet, and posture without turning
                every session into reckless impact volume.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-shell py-16 sm:py-20">
        <SectionHeader
          eyebrow="Values"
          title="Personal development, expressed through training"
          description="These ideas matter because they keep the room safe, serious, and sustainable—not because we perform toughness for its own sake."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-temple-charcoal bg-temple-charcoal/30 p-6 sm:p-7">
            <h3 className="text-lg font-semibold text-temple-snow">Humility and coachability</h3>
            <p className="mt-3 text-sm leading-7 text-temple-snow/80">
              Progress is faster when ego does not get in the way of feedback. We protect a culture where questions are welcome and
              standards are shared openly.
            </p>
          </div>
          <div className="rounded-xl border border-temple-charcoal bg-temple-charcoal/30 p-6 sm:p-7">
            <h3 className="text-lg font-semibold text-temple-snow">Discipline as a daily practice</h3>
            <p className="mt-3 text-sm leading-7 text-temple-snow/80">
              Discipline here means showing up prepared, keeping agreements with partners, and doing the boring details that make technique
              reliable—not posturing.
            </p>
          </div>
          <div className="rounded-xl border border-temple-charcoal bg-temple-charcoal/30 p-6 sm:p-7">
            <h3 className="text-lg font-semibold text-temple-snow">Self-defense and civility</h3>
            <p className="mt-3 text-sm leading-7 text-temple-snow/80">
              Self-defense skill carries responsibility. We train capability alongside respect: control your power, choose calm first, and
              keep accountability to the community you train with.
            </p>
          </div>
          <div className="rounded-xl border border-temple-charcoal bg-temple-charcoal/30 p-6 sm:p-7">
            <h3 className="text-lg font-semibold text-temple-snow">Growth over hype</h3>
            <p className="mt-3 text-sm leading-7 text-temple-snow/80">
              The goal is long-term development—physical, technical, and personal—supported by coaching relationships you can trust.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-temple-charcoal/70 bg-temple-ink">
        <div className="container-shell py-12 sm:py-14">
          <div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-temple-charcoal bg-temple-charcoal/25 p-6 sm:flex-row sm:items-center sm:p-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-temple-accent">Lineage</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-temple-snow sm:text-2xl">For martial artists who want history and formal background</h2>
              <p className="mt-2 text-sm leading-7 text-temple-snow/78">
                Instructor credentials, ranking history, and lineage details are supplemental. They live off the main story so general
                visitors are not asked to parse names and dates before they understand the system.
              </p>
            </div>
            <Link
              to="/about#lineage"
              className="focus-ring shrink-0 rounded-md border border-temple-accent/60 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-temple-accent hover:bg-temple-accent/10"
            >
              Read on About
            </Link>
          </div>
        </div>
      </section>

      <section className="container-shell py-16 sm:py-20">
        <SectionHeader
          eyebrow="Proof"
          title="Outcomes from consistent coaching"
          description="Members stay because the environment is clear: coached progression, transparent expectations, and a culture that rewards consistency."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <TestimonialCard
            quote="I came in anxious and got structure on day one. My conditioning improved, but my confidence changed more."
            name="J. Rivera"
            context="Adult beginner member"
          />
          <TestimonialCard
            quote="Coach Dante runs clean classes with clear expectations. No ego, no chaos, just progress."
            name="M. Collins"
            context="Competition track athlete"
          />
          <TestimonialCard
            quote="I needed a place that respected safety and real standards. Temple Underground delivered both."
            name="S. Patel"
            context="Parent and member"
          />
        </div>
      </section>

      <section className="container-shell py-16 sm:pb-20">
        <SectionHeader
          eyebrow="First class"
          title="What to expect when you visit"
          description="You are guided—not thrown into confusion."
        />
        <div className="mt-8 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6 sm:p-8">
          <ol className="space-y-4 text-sm leading-7 text-temple-snow/82">
            <li>
              <strong className="key-phrase">1) Check-in and quick consult:</strong> goals, prior training, injuries, and pacing preferences.
            </li>
            <li>
              <strong className="key-phrase">2) Warm-up with breath and rhythm:</strong> learn how the room regulates effort before technical work.
            </li>
            <li>
              <strong className="key-phrase">3) Technical block:</strong> fundamentals in striking or grappling with coach feedback and structured partner work.
            </li>
            <li>
              <strong className="key-phrase">4) Conditioning block:</strong> performance-focused work scaled to your level that week.
            </li>
          </ol>
        </div>
      </section>

      <section className="container-shell pb-20 sm:pb-24">
        <SectionHeader eyebrow="FAQ" title="Quick answers before you visit" />
        <div className="mt-8">
          <FAQAccordion items={faqs} />
        </div>
      </section>
    </>
  )
}
