// src/components/landing/LandingFooter.tsx
'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Zap } from 'lucide-react';
import { Button } from '../ui/button';

export function LandingFooter() {
  return (
    <footer className="px-6">
      <div className="mx-auto max-w-6xl border-t border-border pt-16 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          className="rounded-3xl bg-primary text-primary-foreground p-10 sm:p-14 text-center mb-16"
        >
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Point it at your site. See what it actually says.
          </h2>
          <p className="mt-3 text-primary-foreground/80 max-w-md mx-auto">
            Free plan, no credit card. Training takes a couple of minutes.
          </p>
          <Button asChild size="lg" variant="secondary" className="h-11 px-6 text-base mt-7">
            <Link href="/auth">
              Get started free <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </motion.div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Zap className="h-4 w-4 text-primary" /> RagPilot
          </div>
          <p>&copy; {new Date().getFullYear()} RagPilot. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
