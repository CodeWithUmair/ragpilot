// src/components/landing/Hero.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';

// Staged reveal of a real grounded answer — the actual "no hallucination,
// cites its source" behavior documented in docs/STORY.md, dramatized as the
// first thing a visitor sees rather than described in a bullet point.
function HeroChatCard() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 700), // question appears
      setTimeout(() => setStage(2), 1600), // typing dots
      setTimeout(() => setStage(3), 2600), // answer + source
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, rotate: -1 }}
      animate={{ opacity: 1, y: 0, rotate: -1 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 p-4"
    >
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-medium text-muted-foreground">acme-widgets.com</span>
      </div>

      <div className="space-y-3 min-h-[168px]">
        {stage >= 1 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-end"
          >
            <div className="rounded-2xl rounded-br-sm bg-primary text-primary-foreground text-sm px-3 py-2 max-w-[85%]">
              Do you offer AI development services?
            </div>
          </motion.div>
        )}

        {stage === 2 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-1 px-3 py-2">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </motion.div>
        )}

        {stage >= 3 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            <div className="rounded-2xl rounded-bl-sm bg-muted text-sm px-3 py-2 max-w-[90%]">
              Yes, we build custom AI integrations and internal tooling. We don&apos;t offer blockchain
              or crypto services, if that&apos;s what you were comparing against.
            </div>
            <motion.a
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              href="#problem"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary bg-primary/8 rounded-full px-2.5 py-1 w-fit"
            >
              <ExternalLink className="h-3 w-3" /> acme-widgets.com/services
            </motion.a>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-40 pb-28 px-6">
      {/* Soft ambient glow — purely decorative, no external asset */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-[520px] w-[900px] rounded-full bg-primary/15 blur-[120px]"
      />

      <div className="relative mx-auto max-w-6xl grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 rounded-full px-3 py-1 mb-6"
          >
            <Sparkles className="h-3.5 w-3.5" /> Built for real conversations, not a demo prompt
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1]"
          >
            A chat widget that actually knows your site,{' '}
            <span className="text-primary">and admits when it doesn&apos;t.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-6 text-lg text-muted-foreground max-w-lg"
          >
            Give RagPilot a URL. It crawls and indexes your site, then answers visitors with
            grounded, cited replies: no invented prices, no pitching the wrong product, no
            forgetting what they just asked. One script tag, live in minutes.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Button asChild size="lg" className="h-11 px-6 text-base">
              <Link href="/auth">
                Get started free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 px-6 text-base">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </motion.div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <HeroChatCard />
        </div>
      </div>
    </section>
  );
}
