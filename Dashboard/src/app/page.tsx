'use client';

import { useState } from 'react';
import { LandingNav } from '@/components/landing/LandingNav';
import { HeroSection } from '@/components/landing/HeroSection';
import { FeaturesGrid } from '@/components/landing/FeaturesGrid';
import { SwissFocus } from '@/components/landing/SwissFocus';
import { WhiteLabel } from '@/components/landing/WhiteLabel';
import { SrdPreview } from '@/components/landing/SrdPreview';
import { CompanionApp } from '@/components/landing/CompanionApp';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { LoginModal } from '@/components/landing/LoginModal';

export default function HomePage() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div className="landing dark" style={{ fontFamily: "'Outfit', var(--font-sans, sans-serif)" }}>
      <LandingNav onLoginClick={() => setShowLogin(true)} />
      <HeroSection />
      <FeaturesGrid />
      <SwissFocus />
      <WhiteLabel />
      <SrdPreview />
      <CompanionApp />
      <LandingFooter />
      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
