import { Link } from 'react-router-dom'
import SectionHeader from '../components/SectionHeader'
import { useSeo } from '../lib/seo'

export default function AboutPage() {
  useSeo({
    title: 'About & Philosophy | Temple Underground',
    description:
      'Temple Underground training culture: humility, accountability, and coach-led progression within an integrated combat system.',
    pathname: '/about',
  })

  return (
    <div className="container-shell py-16 sm:py-20">
      <SectionHeader
        eyebrow="Philosophy"
        title="A grounded training culture"
        description="We care about how people carry themselves in the room and in life—measured by behavior, not slogans."
      />

      <article className="mt-10 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6 sm:p-8">
        <h3 className="text-2xl font-semibold">What we expect from members</h3>
        <ul className="mt-5 space-y-3 text-sm leading-7 text-temple-snow/82">
          <li>
            - <strong className="text-temple-gold">Respect:</strong> for partners, coaches, and the shared standard that keeps everyone
            safe.
          </li>
          <li>
            - <strong className="text-temple-gold">Consistency:</strong> progress comes from repeated quality work—not occasional spikes of
            intensity.
          </li>
          <li>
            - <strong className="text-temple-gold">Humility:</strong> stay coachable; protect a culture where feedback is normal, not
            personal.
          </li>
          <li>
            - <strong className="text-temple-gold">Accountability:</strong> prepare, recover, and own the agreements you make with your
            training partners.
          </li>
        </ul>
      </article>

      <article className="mt-8 rounded-xl border border-temple-charcoal bg-temple-charcoal/30 p-6 sm:p-8">
        <h3 className="text-2xl font-semibold">Why this feels different from a typical gym</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-temple-charcoal bg-temple-ink/55 p-4">
            <p className="text-sm font-semibold text-temple-gold">Typical experience</p>
            <ul className="mt-3 space-y-2 text-sm text-temple-snow/75">
              <li>- Unclear progression and random intensity</li>
              <li>- Conditioning disconnected from technical skill</li>
              <li>- Limited coaching feedback each session</li>
            </ul>
          </div>
          <div className="rounded-lg border border-temple-gold/30 bg-temple-gold/10 p-4">
            <p className="text-sm font-semibold text-temple-gold">Temple Underground</p>
            <ul className="mt-3 space-y-2 text-sm text-temple-snow/85">
              <li>- Structured curriculum with transparent standards</li>
              <li>- Striking, grappling, and conditioning taught as one system</li>
              <li>- Coach-led corrections and scalable progressions</li>
            </ul>
          </div>
        </div>
      </article>

      <article className="mt-8 rounded-xl border border-temple-charcoal bg-temple-charcoal/35 p-6 sm:p-8">
        <h3 className="text-2xl font-semibold">Curriculum leadership</h3>
        <p className="mt-4 text-sm leading-7 text-temple-snow/82">
          Combat skills, sport preparation, self-defense framing, and combat conditioning are composed and overseen by{' '}
          <span className="key-phrase">Professor Singh</span>, whose graduate work includes a{' '}
          <span className="key-phrase">Master of Education in sports psychology</span> and a{' '}
          <span className="key-phrase">Master of Science in intercultural relations</span>. That lens supports an equitable, diverse room
          where standards are high and access to coaching stays practical.
        </p>
      </article>

      <article id="lineage" className="mt-8 scroll-mt-28 rounded-xl border border-temple-accent/25 bg-temple-ink/70 p-6 sm:p-8">
        <h3 className="text-2xl font-semibold">Lineage and formal backgrounds</h3>
        <p className="mt-4 text-sm leading-7 text-temple-snow/82">
          Some students want the full picture: instructor rank histories, competitive resumes, and traditional lineage connections. We treat
          that information as supplemental—accurate, available, and best discussed with coaches when it helps your training decisions.
        </p>
        <p className="mt-4 text-sm leading-7 text-temple-snow/82">
          If you are comparing schools or researching formal credentials, start with the Coaches page, then bring your questions to a visit
          where details can be placed in context.
        </p>
        <p className="mt-6">
          <Link to="/coaches" className="focus-ring text-sm font-semibold uppercase tracking-wide text-temple-accent hover:text-temple-gold">
            Meet the coaching team →
          </Link>
        </p>
      </article>
    </div>
  )
}
