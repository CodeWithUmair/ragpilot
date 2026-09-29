// src/components/landing/ArchitectureFlow.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { Bot, Globe, MessageCircle, Scissors, Database } from 'lucide-react';

const STEPS = [
  {
    icon: Globe,
    title: 'You give it a URL',
    blurb: 'Crawl + discover',
    detail:
      'RagPilot crawls the sitemap and does a same-origin BFS pass, skipping /checkout, /login and the like, then groups pages into categories you pick from.',
  },
  {
    icon: Scissors,
    title: 'Pages become chunks',
    blurb: 'Chrome stripped, deduped',
    detail:
      'Nav, footers and cookie banners get stripped before anything is embedded — that boilerplate was the #1 cause of hallucinated answers (see below).',
  },
  {
    icon: Database,
    title: 'Chunks become vectors',
    blurb: 'pgvector, HNSW index',
    detail:
      'Each chunk is embedded and stored in Postgres + pgvector, namespaced per chatbot — one tenant can never search another tenant\'s data.',
  },
  {
    icon: Bot,
    title: 'A visitor asks something',
    blurb: 'LangGraph agent decides',
    detail:
      'A graph — not a straight-line pipeline — routes small talk away from retrieval, retries a weak follow-up with a rewritten query, and only then generates.',
  },
  {
    icon: MessageCircle,
    title: 'A grounded, cited answer',
    blurb: 'Streamed to the widget',
    detail:
      'The answer streams token-by-token, only from what was actually retrieved — with the source page linked, not invented.',
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
                <p className="text-[11px] text-muted-foreground hidden sm:block">{s.blurb}</p>
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
