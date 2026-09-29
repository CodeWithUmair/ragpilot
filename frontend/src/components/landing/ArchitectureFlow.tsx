// src/components/landing/ArchitectureFlow.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { Bot, Globe, MessageCircle, Scissors, Database } from 'lucide-react';

const STEPS = [
  {
    icon: Globe,
    title: 'You give it a URL',
    blurb: 'We read your whole site',
    detail:
      'We crawl your site, skipping things like checkout and login pages, then group what we find into categories you choose from.',
  },
  {
    icon: Scissors,
    title: 'Pages become clean knowledge',
    blurb: 'Noise removed first',
    detail:
      'Navigation, footers and cookie banners get stripped before anything is learned. That boilerplate was the single biggest cause of made-up answers.',
  },
  {
    icon: Database,
    title: 'Your content, kept private',
    blurb: 'One account, one namespace',
    detail:
      'What we learn from your site is kept separate from every other account. Your data is never searchable by anyone else\'s chatbot.',
  },
  {
    icon: Bot,
    title: 'A visitor asks something',
    blurb: 'It decides how to respond',
    detail:
      'Small talk gets a quick reply. A vague follow-up gets clarified against the conversation so far before searching again. Only then does it answer.',
  },
  {
    icon: MessageCircle,
    title: 'A grounded, cited answer',
    blurb: 'Streamed live to the widget',
    detail:
      'The answer streams in as it\'s written, built only from what was actually found on your site, with the source page linked, never invented.',
  },
];

export function ArchitectureFlow() {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const ref = useRef(null);
  const inView = useInView(ref, { once: false, margin: '-100px' });

  useEffect(() => {
    if (!autoplay || !inView) return;
    const id = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 2800);
    return () => clearInterval(id);
  }, [autoplay, inView]);

  return (
    <section id="how-it-works" ref={ref} className="py-28 px-6 bg-muted/30">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          className="max-w-2xl mb-16"
        >
          <p className="text-sm font-semibold text-primary mb-3">How it actually works</p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">One URL in, a grounded answer out.</h2>
          <p className="mt-4 text-muted-foreground">Click any step to see what really happens at that stage.</p>
        </motion.div>

        {/* Steps row */}
        <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Connecting line, desktop only */}
          <div className="hidden lg:block absolute top-8 left-[10%] right-[10%] h-px bg-border" aria-hidden />

          {STEPS.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={s.title}
                onClick={() => {
                  setActive(i);
                  setAutoplay(false);
                }}
                className="relative flex flex-col items-center text-center gap-2 group"
              >
                <motion.span
                  animate={{
                    scale: isActive ? 1.12 : 1,
                    backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-card)',
                  }}
                  transition={{ duration: 0.3 }}
                  className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border border-border shadow-sm"
                >
                  <s.icon className={`h-6 w-6 transition-colors ${isActive ? 'text-primary-foreground' : 'text-primary'}`} />
                </motion.span>
                <p className={`text-xs font-semibold transition-colors ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.title}
                </p>
                <p className="text-xs text-muted-foreground hidden sm:block">{s.blurb}</p>
              </button>
            );
          })}
        </div>

        {/* Detail panel for the active step */}
        <div className="mt-10 max-w-2xl mx-auto min-h-[72px]">
          <AnimatePresence mode="wait">
            <motion.p
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="text-center text-[15px] leading-relaxed text-foreground/90 rounded-xl border border-border bg-card px-6 py-4"
            >
              {STEPS[active].detail}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
