import { Medal, Trophy } from 'lucide-react'
import ExpandableText from './ExpandableText'
import SectionHeader from './SectionHeader'

const journeySteps = [
  {
    title: 'Competition-tested results',
    body: (
      <div className="space-y-3">
        <p>
          Temple Underground’s competition team has earned <span className="key-phrase">more than 70 gold medals</span> and{' '}
          <span className="key-phrase">over 200 podium finishes in six years</span> across regional and national tournaments in{' '}
          <span className="key-phrase">Brazilian Jiu-Jitsu</span>.
        </p>
        <p>
          <span className="key-phrase">Pre-COVID</span>, the team accumulated <span className="key-phrase">over a dozen medals and trophies</span>{' '}
          competing at <span className="key-phrase">Golden Gloves</span>, including advancing a fighter to represent{' '}
          <span className="key-phrase">Tennessee</span> in the <span className="key-phrase">2018 USA Boxing Junior Olympic Trials</span>.
        </p>
        <p>
          Instructors still compete in <span className="key-phrase">Brazilian Jiu-Jitsu</span>, so lessons stay aligned with modern rules,
          pacing, and the pressure of an actual tournament week.
        </p>
      </div>
    ),
  },
  {
    title: 'Professional combat and event officiating',
    body: (
      <div className="space-y-3">
        <p>
          Coaches have assisted <span className="key-phrase">professional boxing and MMA athletes</span>, sharpening an eye for what
          transfers under real pressure—not only what looks good in drills.
        </p>
        <p>
          The <span className="key-phrase">head instructor</span> and <span className="key-phrase">Professor Singh</span> also{' '}
          <span className="key-phrase">actively referee martial arts events</span>. They are not only versed in training fighters—they are
          experienced at keeping competitors safe, rendering fair and appropriate judgments, and{' '}
          <span className="key-phrase">de-escalating</span> tense moments when they arise.
        </p>
      </div>
    ),
  },
  {
    title: 'Coaching grounded in the room',
    body: (
      <div className="space-y-3">
        <p>
          The same standards that shape competitors also structure beginner progressions, partner work, and safety—so the competition track
          and the fundamentals track are not two different gyms sharing a wall.
        </p>
        <p>
          Coaching still draws on deep <span className="key-phrase">striking</span> and <span className="key-phrase">grappling</span>{' '}
          experience, but classes are organized as <span className="key-phrase">one integrated program</span>—with{' '}
          <span className="key-phrase">combat conditioning</span> supporting the whole—rather than a patchwork of unrelated styles.
        </p>
      </div>
    ),
  },
]

function JourneyStepsList() {
  return (
    <div className="relative md:mt-2">
      <div
        className="absolute left-[0.65rem] top-2 bottom-2 w-px bg-gradient-to-b from-temple-accent/55 via-temple-accent/25 to-temple-accent/45 md:left-3"
        aria-hidden
      />
      <ol className="relative space-y-10 md:space-y-12">
        {journeySteps.map((step, index) => (
          <li key={step.title} className="relative pl-10 md:pl-14">
            <span
              className="absolute left-0 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-temple-accent/50 bg-temple-ink text-[11px] font-bold text-temple-accent md:left-1 md:h-7 md:w-7 md:text-xs"
              aria-hidden
            >
              {index + 1}
            </span>
            <h3 className="text-lg font-semibold tracking-tight text-temple-snow md:text-xl">{step.title}</h3>
            <div className="mt-2 max-w-3xl text-sm leading-7 text-temple-snow/82 md:text-[15px] md:leading-7">{step.body}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

const ourSystemLead = (
  <p>
    Temple Underground teaches <span className="key-phrase">striking</span> and <span className="key-phrase">grappling</span> as one
    interconnected system. Distance collapses quickly: strikes from range feed standing grappling and clinch exchanges where striking is
    still a real threat. Work from the feet often moves to the ground, and the person on the bottom carries clear danger—especially when
    strikes stay in play. That is why we train distance management and dependable tools at every range relative to your opponent, and why a
    complete system has to account for both striking and grappling.
  </p>
)

const ourSystemExpanded = (
  <div className="max-w-3xl space-y-4 text-sm leading-7 text-temple-snow/82 md:text-[15px] md:leading-7">
    <p>
      For longevity and effective training, <span className="key-phrase">defense comes first</span>: structure is the base that future
      progress sits on, and sound defense becomes part of your offensive timing and pressure. To stay capable across positions and phases,
      we emphasize full-contact training at <span className="key-phrase">scaled resistance</span>. Sequences are taught as connected
      systems—technique chains you can repeat with intent—rather than isolated tricks.
    </p>
    <p>
      Skills are wired together on purpose, so the habits you build support self-defense, competition, and the discipline the practice
      demands. The attentiveness the work requires helps keep the room focused and human—an environment where steady self-improvement stays
      realistic.
    </p>
  </div>
)

export default function ExperienceToSystemSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-temple-accent/5 to-transparent" />

      <div className="container-shell pt-16 sm:pt-20">
        <SectionHeader
          eyebrow="Why Temple Underground"
          title="Built from experience, refined into a system"
          description="This is the path the gym followed: real competition exposure, professional-level coaching context, and years of teaching—then synthesis into one integrated program."
        />
      </div>

      <div className="container-shell pb-16 sm:pb-20">
        <div className="relative mt-10 overflow-hidden rounded-2xl border border-temple-charcoal/80 bg-gradient-to-b from-temple-charcoal/25 via-temple-ink/90 to-temple-charcoal/45 shadow-soft">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-temple-accent/35 to-transparent" />

          <div className="relative p-6 sm:p-10 lg:p-12">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-temple-accent/90">Experience</p>

            <div className="mt-8 overflow-hidden rounded-xl border border-temple-charcoal/70 bg-temple-ink/35">
              <div className="grid gap-4 p-5 sm:grid-cols-2 sm:gap-5 sm:p-6">
                <article className="flex gap-4 rounded-lg border border-temple-accent/25 bg-temple-charcoal/30 p-4 sm:p-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-temple-accent/40 bg-temple-accent/10 text-temple-accent">
                    <Medal className="h-6 w-6" aria-hidden />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight text-temple-snow sm:text-3xl">70+</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-temple-accent">Gold medals</p>
                    <p className="mt-2 text-sm leading-6 text-temple-snow/78">
                      Competition team results across regional and national Brazilian Jiu-Jitsu tournaments.
                    </p>
                  </div>
                </article>
                <article className="flex gap-4 rounded-lg border border-temple-accent/25 bg-temple-charcoal/30 p-4 sm:p-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-temple-accent/40 bg-temple-accent/10 text-temple-accent">
                    <Trophy className="h-6 w-6" aria-hidden />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight text-temple-snow sm:text-3xl">200+</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-temple-accent">Podium finishes</p>
                    <p className="mt-2 text-sm leading-6 text-temple-snow/78">
                      In six years of BJJ competition—podium means <span className="text-temple-snow/90">gold, silver, or bronze</span>—not
                      participation medals.
                    </p>
                  </div>
                </article>
              </div>
              <p className="px-5 pb-3 pt-1 text-center text-xs leading-relaxed text-temple-snow/65 sm:text-sm">
                Coaching depth, pro corners, officiating, and how the room runs—expand to read the full story.
              </p>
              <ExpandableText collapsedLabel="Read full experience" expandedLabel="Hide full experience">
                <JourneyStepsList />
              </ExpandableText>
            </div>

            <div className="relative mt-14 md:mt-16">
              <div className="flex flex-col items-center gap-3 text-center">
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-temple-accent/35 bg-temple-accent/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-temple-accent"
                  aria-hidden
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-temple-accent" />
                  Integration
                </span>
                <p className="max-w-2xl text-sm leading-7 text-temple-snow/78 md:text-[15px]">
                  Those layers of competition, corner work, and mat-tested teaching converge here—not as a list of credentials, but as a
                  single training product you can actually follow class to class.
                </p>
              </div>
            </div>

            <div className="relative mt-14 border-t border-temple-charcoal/80 pt-12 md:mt-16 md:pt-14">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-temple-accent/90">Our system</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-temple-snow sm:text-3xl">
                Vale Tudo-style Jiu-Jitsu as an integrated combat system
              </h3>
              <div className="mt-4 max-w-3xl text-sm leading-7 text-temple-snow/82 md:text-[15px] md:leading-7">{ourSystemLead}</div>

              <div className="mt-6 max-w-3xl">
                <ExpandableText
                  className="overflow-hidden rounded-xl border border-temple-charcoal/70 bg-temple-ink/30"
                  collapsedLabel="Read more about how we train"
                  expandedLabel="Hide extra detail"
                >
                  {ourSystemExpanded}
                </ExpandableText>
              </div>

              <div className="mt-10">
                <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-temple-accent/90">
                  One curriculum — skills first, then what they unlock
                </p>
                <div className="overflow-hidden rounded-2xl border border-temple-accent/30 bg-gradient-to-b from-temple-charcoal/30 via-temple-ink/85 to-temple-charcoal/25 shadow-soft">
                  <div className="grid lg:grid-cols-2">
                    <div className="relative border-b border-temple-accent/20 p-5 sm:p-7 lg:border-b-0 lg:border-r lg:border-temple-accent/25 lg:p-8">
                      <p className="info-chip">The skills you develop</p>
                      <ul className="hover-list mt-4 space-y-3 text-sm leading-7 text-temple-snow/82">
                        <li>
                          <span className="key-phrase">Defense-first framework:</span> priorities stay clear so intensity scales without
                          turning training into guesswork.
                        </li>
                        <li>
                          <span className="key-phrase">Foundational movements</span> drilled and reinforced—the base later technique, timing,
                          and pressure actually build on.
                        </li>
                        <li>
                          <span className="key-phrase">Linked sequences:</span> one technique sets up the next on purpose, so patterns feel
                          like a system—not a bag of unrelated moves.
                        </li>
                      </ul>
                    </div>
                    <div className="relative p-5 sm:p-7 lg:p-8">
                      <p className="info-chip">What you gain from them</p>
                      <ul className="hover-list mt-4 space-y-3 text-sm leading-7 text-temple-snow/82">
                        <li>
                          <span className="key-phrase">A strong foundation</span> you can keep stacking skill on—less time lost re-learning
                          basics every few months.
                        </li>
                        <li>
                          <span className="key-phrase">Clearer understanding of skill:</span> you know what you are practicing, how it
                          connects to the next movement, and why the details matter—so progress stays intentional instead of muddy when
                          pressure shows up.
                        </li>
                        <li>
                          <span className="key-phrase">Capability that carries over</span>—toward competition, protecting yourself and
                          people who depend on you, and steady personal growth—because the same habits stay connected class to class.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
