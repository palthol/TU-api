import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import FAQAccordion from '../components/FAQAccordion'
import SectionHeader from '../components/SectionHeader'
import TestimonialCard from '../components/TestimonialCard'
import { siteConfig } from '../config/site'
import { useSeo } from '../lib/seo'

const faqs = [
  {
    question: 'Do I need experience to start?',
    answer:
      'No. We coach beginners every week. You get clear structure, partner guidance, and a progression that matches your current level.',
  },
  {
    question: 'Is this just hard conditioning?',
    answer:
      'Conditioning is one pillar. We combine it with breathing control and real technical skill so your fitness supports performance.',
  },
  {
    question: 'Can I train without competing?',
    answer:
      'Absolutely. Many members train for confidence, stress control, and long-term health while still learning authentic martial arts.',
  },
]

export default function HomePage() {
  useSeo({
    title: 'Temple Underground | Brazilian Jiu Jitsu, Boxing, and Combative Self-Defense',
    description:
      'Temple Underground in Morristown, Tennessee teaches Brazilian Jiu Jitsu, boxing, and combative self-defense as one integrated system.',
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
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="mx-auto mt-5 max-w-3xl text-base font-medium uppercase tracking-[0.08em] text-temple-snow/90 sm:text-xl"
          >
            Brazilian Jiu Jitsu, Boxing, <span className="text-temple-accent">Combative Self-Defense</span>
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mx-auto mt-6 max-w-3xl text-base leading-7 text-temple-snow/84 sm:text-lg"
          >
            We are a unique combat sports academy that teaches striking, grappling, and submission as a single system. Our classes are
            built to produce calm, durable, and exceptionally well-rounded fighters for combat sport and real-world self-defense.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.13 }}
            className="mx-auto mt-5 max-w-2xl text-sm uppercase tracking-[0.12em] text-temple-snow/72"
          >
            Five days a week training - Sunday through Thursday
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

      <section className="container-shell py-16 sm:py-20">
        <SectionHeader
          eyebrow="Why Temple Underground"
          title="High-level instruction with practical outcomes"
          description="Our coaching standard is built on proven competitive experience and practical teaching that develops well-rounded fighters."
        />
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <article className="hover-lift-card rounded-xl border border-temple-accent/35 bg-temple-ink/70 p-6 shadow-soft">
            <p className="info-chip">Brazilian Jiu Jitsu & Submission Grappling</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-temple-snow">
              <span className="key-stat">Nearly 70 Gold Medals</span> Since 2020
            </h3>
            <p className="mt-3 text-sm leading-7 text-temple-snow/84">
              Team results across IBJJF, NAGA, Fuji, AGF, Chewjitsu, Good Fight, and Newbreed reflect a competition-tested coaching
              environment focused on repeatable high-level outcomes.
            </p>
            <ul className="hover-list mt-4 space-y-2 text-sm text-temple-snow/84">
              <li>
                - <span className="key-phrase">Medals:</span> Nearly 70 gold medals from 2020 to present
              </li>
              <li>
                - <span className="key-phrase">Victories:</span> Consistent wins across regional and national
                tournament circuits
              </li>
              <li>
                - <span className="key-phrase">Leadership:</span> IBJJF-assessed coaching with world, pan-American, and regional
                championship pedigree
              </li>
            </ul>
          </article>
          <article className="hover-lift-card rounded-xl border border-temple-accent/35 bg-temple-ink/70 p-6 shadow-soft">
            <p className="info-chip">Boxing Accolades</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-temple-snow">
              <span className="key-stat">USA Boxing Experience</span> + Junior Olympic Pathway
            </h3>
            <p className="mt-3 text-sm leading-7 text-temple-snow/84">
              Temple Underground coaching draws from competitive boxing and officiating experience in USA Boxing. The academy has produced
              Tennessee representation in the 2018 Southeastern Regional Junior Olympic Trials.
            </p>
            <ul className="hover-list mt-4 space-y-2 text-sm text-temple-snow/84">
              <li>
                - <span className="key-phrase">Competition pipeline:</span> Athlete development through the Junior Olympic qualifying
                pathway in the Southeastern District
              </li>
              <li>
                - <span className="key-phrase">Officiating perspective:</span> Coaching informed by ring-side USA Boxing standards and
                decision criteria
              </li>
              <li>
                - <span className="key-phrase">Instruction focus:</span> Ring-tested fundamentals, tactical discipline, and performance
                under pressure
              </li>
            </ul>
          </article>
        </div>
      </section>

      <section className="container-shell py-16">
        <SectionHeader
          eyebrow="Our System"
          title="One singular integrated combat program"
          description="Temple Underground teaches striking, grappling, and conditioning as one coherent system instead of separate, disconnected classes."
        />
        <div className="hover-lift-card mt-6 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6 sm:p-8">
          <h3 className="text-2xl font-semibold text-temple-snow">Vale Tudo BJJ System</h3>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-temple-snow/84">
            We teach pugilistic submission fighting as a <span className="key-phrase">single system</span>. Instead of separating
            striking, grappling, and conditioning into unrelated classes, we train how these skills connect in real time so students become
            complete fighters with practical self-defense ability.
          </p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <article className="hover-lift-card rounded-lg border border-temple-charcoal bg-temple-ink/55 p-5">
              <p className="info-chip">What we practice</p>
              <ul className="hover-list mt-3 space-y-2 text-sm text-temple-snow/82">
                <li>- Brazilian Jiu Jitsu (gi + no-gi)</li>
                <li>- Boxing fundamentals and applied striking</li>
                <li>- Wrestling and takedown integration</li>
                <li>- Judo entries and off-balancing concepts</li>
                <li>- Combat sports conditioning</li>
                <li>- Combative self-defense scenarios</li>
              </ul>
            </article>
            <article className="hover-lift-card rounded-lg border border-temple-charcoal bg-temple-ink/55 p-5">
              <p className="info-chip">Why we train this way</p>
              <ul className="hover-list mt-3 space-y-2 text-sm text-temple-snow/82">
                <li>- Build fighters who can strike, clinch, and grapple without disconnects</li>
                <li>- Develop better decisions under fatigue and pressure</li>
                <li>- Improve carryover from combat sport to practical self-defense</li>
                <li>- Use judo-based balance breaking to improve wrestling and submission transitions</li>
                <li>- Keep training realistic, structured, and coach-led from day one</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="container-shell py-16">
        <SectionHeader
          eyebrow="Curriculum Leadership"
          title="Program architecture overseen by Professor Singh"
          description="Our curriculum for combat skills, combat sport, combative self-defense, and combat conditioning is composed and overseen by Professor Singh."
        />
        <div className="hover-lift-card mt-8 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6 sm:p-8">
          <p className="text-sm leading-7 text-temple-snow/84">
            Professor Singh holds a <span className="key-phrase">Master of Education in sports psychology</span> and a
            <span className="key-phrase"> Master of Science in intercultural relations</span>. This leadership supports a system that
            serves every part of the public in an <span className="key-phrase">equitable and diverse</span> training environment.
          </p>
        </div>
      </section>

      <section className="container-shell py-16">
        <SectionHeader
          eyebrow="Proof"
          title="Real outcomes from consistent systems"
          description="Replace random workouts with coached progression and standards you can track."
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
            quote="I needed a place that respected safety and discipline. Temple Underground delivered both."
            name="S. Patel"
            context="Parent and member"
          />
        </div>
      </section>

      <section className="container-shell py-16">
        <SectionHeader
          eyebrow="First Class"
          title="What to expect in your first class"
          description="You will not be thrown into chaos. You will be coached."
        />
        <div className="hover-lift-card mt-8 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6">
          <ol className="space-y-4 text-sm leading-6 text-temple-snow/82">
            <li>
              <strong className="key-phrase">1) Check-in + quick consult:</strong> we ask about goals, training background, and
              any injuries.
            </li>
            <li>
              <strong className="key-phrase">2) Guided warm-up + breathing:</strong> you learn how to regulate pace and keep
              composure early.
            </li>
            <li>
              <strong className="key-phrase">3) Technical block:</strong> fundamentals in boxing or BJJ with coach feedback and
              partner structure.
            </li>
            <li>
              <strong className="key-phrase">4) Controlled conditioning:</strong> performance-focused rounds scaled to your level.
            </li>
          </ol>
        </div>
      </section>

      <section className="container-shell py-16">
        <SectionHeader eyebrow="FAQ" title="Quick answers before you visit" />
        <div className="mt-8">
          <FAQAccordion items={faqs} />
        </div>
      </section>
    </>
  )
}
