'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const LANDING_CSS = `/* ─── RESET & BASE ─── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg-base);
  color: #e8e8e8;
  font-family: 'DM Sans', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

/* ─── CSS VARIABLES ─── */
:root {
  /* ── Demo theme variables (Navy) ── */
  --bg-base:#090E1A; --bg-surface:#0D1525; --bg-raised:#111C30; --bg-card:#0F1A2E;
  --accent:#2563EB; --accent-soft:#60A5FA; --accent-muted:rgba(37,99,235,0.12); --accent-glow:rgba(37,99,235,0.25);
  --text-primary:#E8F0FF; --text-secondary:#7A90B8; --text-muted:#3A4E6E;
  --border:rgba(37,99,235,0.18); --border-soft:rgba(255,255,255,0.06); --border-md:rgba(255,255,255,0.11);
  --green:#34D399; --red:#F87171; --yellow:#FCD34D; --amber:#F59E0B;
  --font-display:'Bebas Neue',sans-serif; --font-body:'DM Sans',sans-serif;
  --ff-display:'Bebas Neue',sans-serif; --ff-body:'DM Sans',sans-serif; --ff-mono:'JetBrains Mono',monospace;
  /* Aliases for legacy references in this file */
  --blue:#2563EB; --blue-lt:#60A5FA; --blue-dim:rgba(37,99,235,0.12); --blue-glow:rgba(37,99,235,0.25);
  --bg:#090E1A; --bg2:#0D1525; --bg3:#111C30; --bg4:#0F1A2E;
  --text:#E8F0FF; --text-dim:#3A4E6E;
}

/* ─── GRID BACKGROUND ─── */
.grid-bg {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 80px 80px;
  mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, black 0%, transparent 100%);
}

/* ─── NAV ─── */
nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  height: 64px;
  display: flex; align-items: center; padding: 0 48px;
  background: rgba(8,8,8,0.85);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
}
.nav-logo {
  display: flex; align-items: center; gap: 10px;
  font-family: var(--ff-display); font-size: 22px; letter-spacing: 1px;
  color: var(--text); text-decoration: none;
}
.nav-logo-icon {
  width: 34px; height: 34px; background: var(--blue);
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
}
.nav-logo-icon svg { width: 18px; height: 18px; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; }
.nav-links {
  display: flex; gap: 32px; margin-left: auto; margin-right: 40px;
  list-style: none;
}
.nav-links a {
  color: var(--text-muted); text-decoration: none; font-size: 14px; font-weight: 400;
  transition: color 0.2s; letter-spacing: 0.2px;
}
.nav-links a:hover { color: var(--text); }
.nav-cta {
  display: flex; align-items: center; gap: 10px;
}
.btn-ghost {
  padding: 8px 18px; border: 1px solid var(--border-md);
  background: transparent; color: var(--text-muted);
  border-radius: 8px; font-family: var(--ff-body); font-size: 14px;
  cursor: pointer; transition: all 0.2s; text-decoration: none;
}
.btn-ghost:hover { border-color: rgba(255,255,255,0.22); color: var(--text); }
.btn-login {
  padding: 8px 18px; border: 1px solid var(--border-md);
  background: transparent; color: var(--text);
  border-radius: 8px; font-family: var(--ff-body); font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.2s; text-decoration: none;
}
.btn-login:hover { border-color: rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); }
.btn-primary {
  padding: 9px 20px; background: var(--blue);
  border: none; border-radius: 8px; color: #fff;
  font-family: var(--ff-body); font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.2s; text-decoration: none;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn-primary:hover { background: var(--blue-lt); transform: translateY(-1px); }

/* ─── HERO ─── */
.hero {
  min-height: 100vh; display: flex; align-items: center;
  padding: 120px 48px 80px; position: relative; z-index: 1;
}
.hero-inner {
  max-width: 1200px; margin: 0 auto; width: 100%;
  display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center;
}
.hero-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--blue-dim); border: 1px solid rgba(59,130,246,0.25);
  border-radius: 20px; padding: 5px 14px;
  font-size: 11px; font-weight: 600; color: var(--blue-lt);
  letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 24px;
}
.hero-eyebrow-dot {
  width: 6px; height: 6px; background: var(--blue-lt);
  border-radius: 50%; animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.hero-h1 {
  font-family: var(--ff-display);
  font-size: clamp(64px, 7vw, 100px);
  line-height: 0.95;
  letter-spacing: 1px;
  color: #fff;
  margin-bottom: 10px;
}
.hero-h1 .accent {
  color: transparent;
  -webkit-text-stroke: 1.5px rgba(255,255,255,0.25);
}
.hero-h1 .blue { color: var(--blue-lt); }
.hero-sub {
  font-size: 18px; font-weight: 300; color: #999;
  line-height: 1.65; margin-bottom: 40px; max-width: 460px;
  letter-spacing: 0.1px;
}
.hero-sub strong { color: var(--text); font-weight: 500; }
.hero-actions { display: flex; align-items: center; gap: 16px; margin-bottom: 48px; }
.btn-hero {
  padding: 14px 28px; background: var(--blue);
  border: none; border-radius: 10px; color: #fff;
  font-family: var(--ff-body); font-size: 15px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; text-decoration: none;
  display: inline-flex; align-items: center; gap: 8px;
  box-shadow: 0 0 40px rgba(37,99,235,0.35);
}
.btn-hero:hover {
  background: var(--blue-lt); transform: translateY(-2px);
  box-shadow: 0 0 60px rgba(59,130,246,0.45);
}
.btn-hero svg { width: 16px; height: 16px; stroke: #fff; fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.hero-link {
  color: var(--text); font-size: 14px; text-decoration: none;
  display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s;
  padding: 12px 22px; border: 1px solid var(--border-md); border-radius: 10px;
  background: transparent;
}
.hero-link:hover { border-color: rgba(255,255,255,0.22); background: rgba(255,255,255,0.04); }
.hero-link svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hero-stats {
  display: flex; gap: 32px;
  border-top: 1px solid var(--border); padding-top: 32px;
}
.hero-stat {}
.hero-stat-n {
  font-family: var(--ff-display); font-size: 36px; color: #fff; letter-spacing: 0.5px; line-height: 1;
}
.hero-stat-n span { color: var(--blue-lt); }
.hero-stat-l { font-size: 12px; color: var(--text-muted); margin-top: 4px; letter-spacing: 0.2px; }

/* ─── PHONE MOCK ─── */
.hero-visual { display: flex; justify-content: center; align-items: center; }
.phone-frame {
  width: 320px; height: 640px;
  background: var(--bg3);
  border-radius: 44px;
  border: 1.5px solid var(--border-md);
  position: relative; overflow: hidden;
  box-shadow:
    0 0 0 6px rgba(255,255,255,0.03),
    0 40px 120px rgba(0,0,0,0.8),
    inset 0 1px 0 rgba(255,255,255,0.08);
}
/* Subtle blue glow behind phone */
.phone-frame::before {
  content: '';
  position: absolute; inset: -60px;
  background: radial-gradient(ellipse 60% 80% at 50% 50%, rgba(37,99,235,0.15) 0%, transparent 70%);
  z-index: -1; pointer-events: none;
}
.phone-notch {
  width: 100px; height: 28px; background: var(--bg);
  border-radius: 0 0 18px 18px; margin: 0 auto;
  position: relative; z-index: 2;
}
.phone-screen {
  padding: 0 20px 20px; height: calc(100% - 28px);
  display: flex; flex-direction: column;
}

/* Call Header */
.call-header {
  background: linear-gradient(180deg, rgba(37,99,235,0.18) 0%, transparent 100%);
  margin: 0 -20px; padding: 18px 20px 20px;
  text-align: center; border-bottom: 1px solid var(--border);
}
.call-biz { font-size: 10px; font-weight: 600; color: var(--text-muted); letter-spacing: 1.5px; text-transform: uppercase; }
.call-name { font-size: 18px; font-weight: 500; color: #fff; margin: 4px 0 2px; }
.call-status {
  font-size: 11px; color: var(--green); font-weight: 500;
  display: flex; align-items: center; justify-content: center; gap: 5px;
}
.call-status-dot { width: 5px; height: 5px; background: var(--green); border-radius: 50%; }
.call-timer { font-family: var(--ff-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px; }

/* Waveform */
.waveform {
  display: flex; align-items: center; justify-content: center;
  gap: 3px; padding: 16px 0 12px;
}
.wave-bar {
  width: 3px; border-radius: 2px; background: var(--blue-lt);
  animation: wave 1.2s ease-in-out infinite;
  opacity: 0.7;
}
.wave-bar:nth-child(1) { height: 8px; animation-delay: 0s; }
.wave-bar:nth-child(2) { height: 16px; animation-delay: 0.1s; }
.wave-bar:nth-child(3) { height: 22px; animation-delay: 0.2s; }
.wave-bar:nth-child(4) { height: 28px; animation-delay: 0.3s; }
.wave-bar:nth-child(5) { height: 34px; animation-delay: 0.15s; }
.wave-bar:nth-child(6) { height: 26px; animation-delay: 0.25s; }
.wave-bar:nth-child(7) { height: 18px; animation-delay: 0.35s; }
.wave-bar:nth-child(8) { height: 10px; animation-delay: 0.05s; }
.wave-bar:nth-child(9) { height: 22px; animation-delay: 0.2s; }
.wave-bar:nth-child(10) { height: 30px; animation-delay: 0.3s; }
.wave-bar:nth-child(11) { height: 24px; animation-delay: 0.1s; }
.wave-bar:nth-child(12) { height: 14px; animation-delay: 0.4s; }
.wave-bar:nth-child(13) { height: 8px; animation-delay: 0s; }
@keyframes wave {
  0%, 100% { transform: scaleY(0.4); opacity: 0.4; }
  50% { transform: scaleY(1); opacity: 0.85; }
}

/* Transcript bubbles */
.transcript { flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 6px; padding: 4px 0 8px; }
.caption-line { display: flex; flex-direction: column; gap: 1px; padding: 2px 0; }
.caption-who { font-size: 8px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; }
.caption-who.ai { color: var(--blue-lt); }
.caption-who.caller { color: #888; }
.caption-text { font-size: 11px; color: #ccc; line-height: 1.45; }
.bubble {
  padding: 9px 12px; border-radius: 12px; font-size: 12px; line-height: 1.5;
  animation: fadeUp 0.4s ease both;
}
.bubble-ai {
  background: var(--blue-dim); border: 1px solid rgba(59,130,246,0.18);
  color: #cce0ff; border-radius: 12px 12px 12px 4px; align-self: flex-start; max-width: 90%;
}
.bubble-ai .from { font-size: 9px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--blue-lt); margin-bottom: 4px; }
.bubble-user {
  background: var(--bg4); border: 1px solid var(--border);
  color: #bbb; border-radius: 12px 12px 4px 12px; align-self: flex-end; max-width: 90%;
}
.bubble-user .from { font-size: 9px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.bubble:nth-child(1) { animation-delay: 0.2s; }
.bubble:nth-child(2) { animation-delay: 0.7s; }
.bubble:nth-child(3) { animation-delay: 1.2s; }
.bubble:nth-child(4) { animation-delay: 1.7s; }

/* Booking confirmation pill */
.booking-confirm {
  background: var(--green-dim); border: 1px solid rgba(34,197,94,0.22);
  border-radius: 10px; padding: 10px 12px; margin-top: 4px;
  display: flex; align-items: center; gap: 10px;
}
.booking-confirm-icon {
  width: 28px; height: 28px; background: rgba(34,197,94,0.2);
  border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.booking-confirm-icon svg { width: 14px; height: 14px; stroke: var(--green); fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.booking-confirm-txt { }
.booking-confirm-title { font-size: 11px; font-weight: 600; color: var(--green); }
.booking-confirm-sub { font-size: 10px; color: var(--text-muted); margin-top: 1px; }

/* ─── LOGO BAR ─── */
.logo-bar {
  position: relative; z-index: 1;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  padding: 28px 48px;
}
.logo-bar-inner {
  max-width: 1200px; margin: 0 auto;
  display: flex; align-items: center; gap: 48px;
}
.logo-bar-label {
  font-size: 11px; font-weight: 600; color: var(--text-dim);
  letter-spacing: 1.5px; text-transform: uppercase; white-space: nowrap;
}
.logo-bar-items {
  display: flex; align-items: center; gap: 40px; flex-wrap: wrap;
}
.logo-bar-item {
  font-family: var(--ff-display); font-size: 18px; letter-spacing: 1px;
  color: var(--text-dim); white-space: nowrap; transition: color 0.2s;
}
.logo-bar-item:hover { color: var(--text-muted); }

/* ─── HOW IT WORKS ─── */
.section { padding: 100px 48px; position: relative; z-index: 1; }
.section-inner { max-width: 1200px; margin: 0 auto; }
.section-eyebrow {
  font-size: 11px; font-weight: 600; color: var(--blue-lt);
  letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px;
}
.section-h2 {
  font-family: var(--ff-display);
  font-size: clamp(44px, 5vw, 68px);
  line-height: 0.95; letter-spacing: 0.5px; color: #fff;
  margin-bottom: 16px;
}
.section-sub {
  font-size: 17px; font-weight: 300; color: #888;
  max-width: 520px; line-height: 1.65; margin-bottom: 64px;
}

/* Steps */
.steps {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 2px; background: var(--border);
  border: 1px solid var(--border); border-radius: 16px; overflow: hidden;
}
.step {
  background: var(--bg2); padding: 40px 36px;
  position: relative; transition: background 0.2s;
}
.step:hover { background: var(--bg3); }
.step-num {
  font-family: var(--ff-display); font-size: 72px; line-height: 1;
  color: rgba(255,255,255,0.04); position: absolute; top: 20px; right: 24px;
  pointer-events: none; letter-spacing: -2px;
}
.step-icon {
  width: 44px; height: 44px; border-radius: 10px;
  background: var(--blue-dim); border: 1px solid rgba(59,130,246,0.2);
  display: flex; align-items: center; justify-content: center; margin-bottom: 24px;
}
.step-icon svg { width: 20px; height: 20px; stroke: var(--blue-lt); fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.step-h { font-family: var(--ff-display); font-size: 26px; letter-spacing: 0.3px; color: #fff; margin-bottom: 12px; }
.step-p { font-size: 14px; font-weight: 300; color: #888; line-height: 1.65; }
.step-connector {
  position: absolute; right: -1px; top: 50%; transform: translateY(-50%);
  width: 2px; height: 40px; background: var(--blue);
  display: none;
}

/* ─── FEATURES ─── */
.features-bg { background: var(--bg2); }
.features-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}
.feat-card {
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 14px; padding: 32px;
  transition: all 0.25s; cursor: default; position: relative; overflow: hidden;
}
.feat-card::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, var(--blue-dim) 0%, transparent 60%);
  opacity: 0; transition: opacity 0.3s;
}
.feat-card:hover { border-color: rgba(59,130,246,0.25); transform: translateY(-2px); }
.feat-card:hover::before { opacity: 1; }
.feat-card.wide { grid-column: 1 / -1; }
.feat-icon {
  width: 40px; height: 40px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 20px; position: relative; z-index: 1;
}
.feat-icon svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.feat-icon.blue { background: var(--blue-dim); color: var(--blue-lt); border: 1px solid rgba(59,130,246,0.2); }
.feat-icon.green { background: rgba(34,197,94,0.1); color: var(--green); border: 1px solid rgba(34,197,94,0.2); }
.feat-icon.amber { background: rgba(245,158,11,0.1); color: var(--amber); border: 1px solid rgba(245,158,11,0.2); }
.feat-icon.red { background: rgba(239,68,68,0.1); color: var(--red); border: 1px solid rgba(239,68,68,0.2); }
.feat-h {
  font-family: var(--ff-display); font-size: 24px; letter-spacing: 0.3px;
  color: #fff; margin-bottom: 10px; position: relative; z-index: 1;
}
.feat-p { font-size: 14px; font-weight: 300; color: #777; line-height: 1.7; position: relative; z-index: 1; }
.feat-tag {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 600; letter-spacing: 1px;
  text-transform: uppercase; padding: 3px 8px; border-radius: 4px;
  margin-top: 16px; position: relative; z-index: 1;
}
.feat-tag.blue { background: var(--blue-dim); color: var(--blue-lt); }
.feat-tag.green { background: rgba(34,197,94,0.1); color: var(--green); }

/* Coverage row inside wide feature card */
.coverage-row {
  display: flex; gap: 12px; margin-top: 20px; position: relative; z-index: 1;
  flex-wrap: wrap;
}
.cov-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 500;
  border: 1px solid;
}
.cov-badge.full { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.2); color: var(--green); }
.cov-badge.partial { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.2); color: var(--amber); }
.cov-badge.none { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.2); color: var(--red); }
.cov-dot { width: 7px; height: 7px; border-radius: 50%; }
.cov-dot.full { background: var(--green); }
.cov-dot.partial { background: var(--amber); }
.cov-dot.none { background: var(--red); }

/* ─── PRICING ─── */
.pricing-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 16px; margin-top: 0;
}
.price-card {
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 16px; padding: 36px 32px;
  position: relative; transition: all 0.2s;
}
.price-card:hover { border-color: var(--border-md); transform: translateY(-2px); }
.price-card.featured {
  border-color: rgba(59,130,246,0.4);
  background: linear-gradient(180deg, rgba(37,99,235,0.08) 0%, var(--bg3) 100%);
}
.price-card.featured::before {
  content: 'MOST POPULAR';
  position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
  background: var(--blue); color: #fff;
  font-family: var(--ff-display); font-size: 11px; letter-spacing: 1.5px;
  padding: 4px 16px; border-radius: 0 0 8px 8px;
}
.price-name {
  font-family: var(--ff-display); font-size: 20px; letter-spacing: 0.5px;
  color: var(--text-muted); margin-bottom: 16px;
}
.price-amount {
  display: flex; align-items: baseline; gap: 4px;
  margin-bottom: 6px;
}
.price-dollar { font-size: 22px; font-weight: 400; color: #888; margin-top: 4px; }
.price-num {
  font-family: var(--ff-display); font-size: 60px; line-height: 1;
  color: #fff; letter-spacing: -1px;
}
.price-period { font-size: 14px; color: var(--text-muted); }
.price-desc { font-size: 13px; color: #666; margin-bottom: 28px; min-height: 36px; line-height: 1.55; }
.price-divider { border: none; border-top: 1px solid var(--border); margin-bottom: 24px; }
.price-features { list-style: none; display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
.price-features li {
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 13px; color: #999; line-height: 1.4;
}
.price-features li .check {
  width: 16px; height: 16px; border-radius: 50%;
  background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.25);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.price-features li .check svg { width: 9px; height: 9px; stroke: var(--green); fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.price-btn {
  width: 100%; padding: 12px; border-radius: 10px;
  font-family: var(--ff-body); font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; text-align: center;
  display: block; text-decoration: none;
}
.price-btn.outline {
  background: transparent; border: 1px solid var(--border-md); color: var(--text-muted);
}
.price-btn.outline:hover { border-color: rgba(255,255,255,0.22); color: var(--text); }
.price-btn.filled {
  background: var(--blue); border: 1px solid transparent; color: #fff;
  box-shadow: 0 0 30px rgba(37,99,235,0.3);
}
.price-btn.filled:hover { background: var(--blue-lt); box-shadow: 0 0 50px rgba(59,130,246,0.4); }
.trial-note {
  text-align: center; font-size: 13px; color: var(--text-muted);
  margin-top: 24px;
}
.trial-note span { color: var(--text); font-weight: 500; }

/* ─── SUPPORTED BUSINESSES ─── */
.biz-grid {
  display: flex; gap: 10px; flex-wrap: wrap;
}
.biz-chip {
  padding: 7px 14px; border: 1px solid var(--border);
  border-radius: 24px; font-size: 13px; color: var(--text-muted);
  background: var(--bg3); transition: all 0.2s; cursor: default;
}
.biz-chip:hover { border-color: var(--border-md); color: var(--text); }


/* ─── CTA BAND ─── */
.cta-band {
  position: relative; z-index: 1;
  padding: 100px 48px;
  border-top: 1px solid var(--border);
  text-align: center;
  background: radial-gradient(ellipse 60% 80% at 50% 100%, rgba(37,99,235,0.1) 0%, transparent 70%);
}
.cta-band-h {
  font-family: var(--ff-display);
  font-size: clamp(52px, 6vw, 88px);
  line-height: 0.95; letter-spacing: 0.5px; color: #fff;
  margin-bottom: 20px;
}
.cta-band-sub {
  font-size: 17px; font-weight: 300; color: #888;
  margin-bottom: 44px; max-width: 460px; margin-left: auto; margin-right: auto;
  line-height: 1.65;
}
.cta-band-actions { display: flex; align-items: center; justify-content: center; gap: 16px; }
.cta-number {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--bg4); border: 1px solid var(--border-md);
  border-radius: 10px; padding: 14px 24px;
  font-family: var(--ff-mono); font-size: 16px; color: var(--text);
}
.cta-number-label { font-family: var(--ff-body); font-size: 11px; color: var(--text-muted); font-family: var(--ff-mono); }

/* ─── FOOTER ─── */
footer {
  position: relative; z-index: 1;
  border-top: 1px solid var(--border);
  padding: 36px 48px;
  display: flex; align-items: center; justify-content: space-between;
}
.footer-logo { font-family: var(--ff-display); font-size: 18px; letter-spacing: 0.5px; color: var(--text-muted); }
.footer-copy { font-size: 12px; color: var(--text-dim); }
.footer-links { display: flex; gap: 24px; }
.footer-links a { font-size: 12px; color: var(--text-dim); text-decoration: none; transition: color 0.2s; }
.footer-links a:hover { color: var(--text-muted); }

/* ─── DIVIDER LINE ─── */
.section-divider {
  height: 1px; background: var(--border);
  max-width: 1200px; margin: 0 auto;
}

/* ─── ANIMATIONS ─── */
.reveal {
  opacity: 0; transform: translateY(24px);
  transition: opacity 0.7s ease, transform 0.7s ease;
}
.reveal.visible { opacity: 1; transform: translateY(0); }
.reveal-delay-1 { transition-delay: 0.1s; }
.reveal-delay-2 { transition-delay: 0.2s; }
.reveal-delay-3 { transition-delay: 0.3s; }

/* ─── SCROLLBAR ─── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: #222; border-radius: 3px; }

/* ─── RESPONSIVE ─── */
@media (max-width: 900px) {
  nav { padding: 0 24px; }
  .nav-links { display: none; }
  .hero { padding: 100px 24px 60px; }
  .hero-inner { grid-template-columns: 1fr; gap: 60px; }
  .phone-frame { width: 280px; height: 540px; }
  .section { padding: 72px 24px; }
  .steps { grid-template-columns: 1fr; }
  .features-grid { grid-template-columns: 1fr; }
  .feat-card.wide { grid-column: 1; }
  .pricing-grid { grid-template-columns: 1fr; }
  .cta-band { padding: 72px 24px; }
  footer { flex-direction: column; gap: 16px; text-align: center; padding: 24px; }
  .logo-bar { padding: 24px; }
  .logo-bar-inner { flex-direction: column; gap: 16px; align-items: flex-start; }
}
`;
const LANDING_HTML = `
<div class="grid-bg"></div>

<!-- NAV -->
<nav>
  <a href="#" class="nav-logo">
    <div class="nav-logo-icon">
      <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014 12.5a19.8 19.8 0 01-3-8.61A2 2 0 013 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
    </div>
    SECRETARY HQ
  </a>
  <ul class="nav-links">
    <li><a href="#how">How It Works</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#pricing">Pricing</a></li>
    <li><a href="#businesses">Industries</a></li>
  </ul>
  <div class="nav-cta">
    <a href="/dashboard" class="btn-login">Log in</a>
    <a href="/dashboard" class="btn-primary">
      Start free trial
    </a>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="hero-inner">
    <div class="hero-content">
      <div class="hero-eyebrow reveal">
        <div class="hero-eyebrow-dot"></div>
        AI-Powered Business Reception
      </div>

      <h1 class="hero-h1 reveal reveal-delay-1">
        YOUR<br>
        PHONE<br>
        <span class="blue">NEVER</span><br>
        <span class="accent">SLEEPS</span>
      </h1>

      <p class="hero-sub reveal reveal-delay-2">
        A <strong>human-sounding AI secretary</strong> answers every call, books appointments intelligently, and knows your business inside out. From day one, without hiring anyone.
      </p>

      <div class="hero-actions reveal reveal-delay-2">
        <a href="/dashboard" class="btn-hero">
          Start free — 14 days
          <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
        <a href="https://localhost:4001/demo" class="hero-link">
          Try the interactive demo
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M10 15l5-3-5-3v6z" fill="currentColor" stroke="none"/></svg>
        </a>
      </div>

      <div class="hero-stats reveal reveal-delay-3">
        <div class="hero-stat">
          <div class="hero-stat-n">20<span>+</span></div>
          <div class="hero-stat-l">business types</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-n"><span>\$</span>129</div>
          <div class="hero-stat-l">starts at / month</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-n">7<span>-layer</span></div>
          <div class="hero-stat-l">booking validation</div>
        </div>
      </div>
    </div>

    <!-- Phone Mock -->


    <div class="hero-visual reveal reveal-delay-2">
      <div class="phone-frame">
        <div class="phone-notch"></div>
        <div class="phone-screen">

          <!-- CALL HEADER -->
          <div class="call-header">
            <div class="call-biz">Luxe Hair Studio</div>
            <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin:6px 0 2px;">
              <div style="width:36px;height:36px;border-radius:50%;background:rgba(37,99,235,0.2);border:1px solid rgba(37,99,235,0.35);display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014 12.5a19.8 19.8 0 01-3-8.61A2 2 0 013 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
              </div>
            </div>
            <div class="call-name">Incoming Call</div>
            <div class="call-status">
              <div class="call-status-dot"></div>
              On Call · Secretary HQ
            </div>
            <div class="call-timer" id="callTimer">03:41</div>
          </div>

          <!-- WAVEFORM -->
          <div class="waveform">
            <div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div><div class="wave-bar"></div>
            <div class="wave-bar"></div>
          </div>

          <!-- LIVE CAPTION TRANSCRIPT -->
          <div class="transcript" id="transcript" style="overflow-y:auto;scrollbar-width:none;display:flex;flex-direction:column;gap:6px;padding:4px 0 8px;">

            <div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:5px;margin:2px 0;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014 12.5"/></svg>
              <span style="font-size:8px;color:#22c55e;font-weight:600;letter-spacing:0.5px;">Caller ID matched · Sandra K. · 14 visits</span>
            </div>

            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Thank you for calling Luxe Hair Studio! How can I help you?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">Hi! I'd like to book an appointment please.</span>
            </div>
            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Just to confirm — am I speaking with Sandra Chen?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">Yes, that's me!</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.2);border-radius:5px;margin:2px 0;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              <span style="font-size:8px;color:#a78bfa;font-weight:600;letter-spacing:0.5px;">Identity confirmed · CRM loaded · Jess · last: balayage</span>
            </div>

            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Welcome back, Sandra! What can I do for you today?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">I'd like to get in with Jess for a balayage.</span>
            </div>
            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Last time you skipped the blow-dry — same this time?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">Yes, exactly.</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:5px;margin:2px 0;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              <span style="font-size:8px;color:#22c55e;font-weight:600;letter-spacing:0.5px;">Promotion matched · Olaplex gloss · 20% off</span>
            </div>

            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">We have 20% off Olaplex gloss this month — want to add it on?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">Sure, that sounds great!</span>
            </div>
            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Perfect — 2.5 hours total. Jess has openings this week and next. What day works?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">Saturday the 15th if possible.</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);border-radius:5px;margin:2px 0;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <span style="font-size:8px;color:#3b82f6;font-weight:600;letter-spacing:0.5px;">Checking Jess · Sat 15th · 2.5hr slots open ✓</span>
            </div>

            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Saturday the 15th works. What time were you thinking?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">10am if Jess has it?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Jess has 10am open. Anything else before I confirm?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">No scalp massage please.</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:5px;margin:2px 0;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span style="font-size:8px;color:#f59e0b;font-weight:600;letter-spacing:0.5px;">Preference saved · no scalp massage</span>
            </div>

            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">Saturday 15th, 10am, balayage + Olaplex with Jess, no blow-dry, no scalp massage. Confirm?</span>
            </div>
            <div class="caption-line">
              <span class="caption-who caller">Sandra</span>
              <span class="caption-text">Yes please!</span>
            </div>
            <div class="caption-line">
              <span class="caption-who ai">Secretary HQ</span>
              <span class="caption-text">You're all set! Sending your confirmation text now.</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;padding:3px 8px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:5px;margin:2px 0;">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span style="font-size:8px;color:#22c55e;font-weight:600;letter-spacing:0.5px;">SMS sent · number validated ✓</span>
            </div>

            <!-- Booking confirmed pill -->
            <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.22);border-radius:8px;padding:8px 10px;margin-top:2px;">
              <div style="font-size:9px;font-weight:600;color:#22c55e;margin-bottom:3px;">✓ Appointment Confirmed</div>
              <div style="font-size:9px;color:#666;">Sat 15th · 10am · Jess · Balayage + Olaplex · 2.5hr</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">
                <span style="font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(167,139,250,0.12);color:#a78bfa;font-weight:600;">CRM updated</span>
                <span style="font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(59,130,246,0.12);color:#3b82f6;font-weight:600;">Stylist matched</span>
                <span style="font-size:8px;padding:1px 6px;border-radius:3px;background:rgba(245,158,11,0.12);color:#f59e0b;font-weight:600;">SMS sent</span>
              </div>
            </div>

          </div>

          <!-- CALL CONTROLS -->
          <div style="display:flex;justify-content:center;align-items:center;gap:16px;padding:12px 0 8px;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v3M8 23h8"/></svg>
              </div>
              <span style="font-size:8px;color:#555;">Mute</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:50px;height:50px;border-radius:50%;background:#ef4444;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(239,68,68,0.4);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2V20a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.42 19.42 0 013.07 8.63 2 2 0 015 6.45a12.84 12.84 0 00.7-2.81 2 2 0 012.11-.45l.71.71"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </div>
              <span style="font-size:8px;color:#ef4444;">End</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
              </div>
              <span style="font-size:8px;color:#555;">Speaker</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</section>

<!-- LOGO BAR -->
<div class="logo-bar">
  <div class="logo-bar-inner">
    <span class="logo-bar-label">Built for</span>
    <div class="logo-bar-items">
      <span class="logo-bar-item">Auto Shops</span>
      <span class="logo-bar-item">Tire Services</span>
      <span class="logo-bar-item">Hair Salons</span>
      <span class="logo-bar-item">Barbershops</span>
      <span class="logo-bar-item">Gyms</span>
      <span class="logo-bar-item">Plumbers</span>
      <span class="logo-bar-item">HVAC</span>
      <span class="logo-bar-item">Real Estate</span>
      <span class="logo-bar-item">Restaurants</span>
    </div>
  </div>
</div>

<!-- MISSED CALL COST SECTION -->
<section class="section" style="padding-top:80px;padding-bottom:80px;background:var(--bg2);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
  <div class="section-inner">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;">
      <div>
        <div class="section-eyebrow reveal">The problem you already have</div>
        <h2 class="section-h2 reveal reveal-delay-1" style="margin-bottom:24px;">YOUR PHONE<br>IS COSTING<br>YOU A FORTUNE.</h2>
        <p style="font-size:17px;font-weight:300;color:#888;line-height:1.7;margin-bottom:32px;max-width:460px;" class="reveal reveal-delay-2">
          You didn't miss that call because you didn't care. You missed it because you were doing the job. But the customer didn't wait — they called your competitor instead. And they're never coming back.
        </p>
        <div style="display:flex;flex-direction:column;gap:16px;" class="reveal reveal-delay-2">
          <div style="display:flex;align-items:flex-start;gap:14px;">
            <div style="width:8px;height:8px;background:var(--red);border-radius:50%;margin-top:7px;flex-shrink:0;"></div>
            <p style="font-size:15px;color:#999;line-height:1.6;"><strong style="color:#e8e8e8;">85% of callers who don't get an answer never call back.</strong> They go straight to the next business on Google.</p>
          </div>
          <div style="display:flex;align-items:flex-start;gap:14px;">
            <div style="width:8px;height:8px;background:var(--red);border-radius:50%;margin-top:7px;flex-shrink:0;"></div>
            <p style="font-size:15px;color:#999;line-height:1.6;"><strong style="color:#e8e8e8;">Home service businesses miss 62% of inbound calls</strong> on average — during the job, at lunch, after hours.</p>
          </div>
          <div style="display:flex;align-items:flex-start;gap:14px;">
            <div style="width:8px;height:8px;background:var(--red);border-radius:50%;margin-top:7px;flex-shrink:0;"></div>
            <p style="font-size:15px;color:#999;line-height:1.6;"><strong style="color:#e8e8e8;">Each missed call in auto services costs \$300–\$1,200.</strong> That's not a phone problem. That's a revenue problem.</p>
          </div>
        </div>
      </div>
      <div class="reveal reveal-delay-1">
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:20px;padding:48px 40px;position:relative;overflow:hidden;">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--red),var(--amber));"></div>
          <div style="font-family:var(--ff-display);font-size:13px;letter-spacing:2px;color:var(--text-muted);margin-bottom:12px;">AVERAGE ANNUAL LOSS</div>
          <div style="font-family:var(--ff-display);font-size:88px;line-height:0.9;color:#fff;letter-spacing:-2px;margin-bottom:8px;">\$126K</div>
          <div style="font-size:15px;color:#888;margin-bottom:40px;font-weight:300;">Lost every year by a typical small business<br>from missed calls alone.</div>
          <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
            <div>
              <div style="font-family:var(--ff-display);font-size:42px;color:var(--amber);letter-spacing:-1px;">\$279</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;">Secretary HQ<br>Growth plan / month</div>
            </div>
            <div>
              <div style="font-family:var(--ff-display);font-size:42px;color:var(--green);letter-spacing:-1px;">45×</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;">Return on investment<br>in year one</div>
            </div>
          </div>
          <div style="margin-top:24px;padding:14px 16px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.18);border-radius:10px;">
            <div style="font-size:13px;color:var(--green);font-weight:500;margin-bottom:4px;">The math is simple.</div>
            <div style="font-size:12px;color:#888;line-height:1.6;">\$279/mo × 12 = \$3,348/year.<br>One captured job per week pays for the whole year.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section class="section" id="how">
  <div class="section-inner">
    <div class="section-eyebrow reveal">How it works</div>
    <h2 class="section-h2 reveal reveal-delay-1">LIVE IN UNDER<br>10 MINUTES</h2>
    <p class="section-sub reveal reveal-delay-2">Pick your business type. Answer a few questions. Get a real phone number. Your AI secretary is live before your next coffee gets cold.</p>
    <div class="steps reveal reveal-delay-2">
      <div class="step">
        <div class="step-num">01</div>
        <div class="step-icon"><svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg></div>
        <div class="step-h">Pick your template</div>
        <p class="step-p">Choose from 29 business types. Auto shop, salon, gym, plumber — each has the right vocabulary, services, and defaults pre-loaded.</p>
      </div>
      <div class="step">
        <div class="step-num">02</div>
        <div class="step-icon"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="step-h">Add your team</div>
        <p class="step-p">Enter staff, their skills, working hours, and which bays or stations they use. The AI validates every booking against all three.</p>
      </div>
      <div class="step">
        <div class="step-num">03</div>
        <div class="step-icon"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014 12.5a19.8 19.8 0 01-3-8.61A2 2 0 013 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg></div>
        <div class="step-h">Your number goes live</div>
        <p class="step-p">Pick an area code. We provision a real phone number and a trained AI voice agent automatically. Call it immediately — no waiting, no manual setup.</p>
      </div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="section" id="pricing">
  <div class="section-inner">
    <div class="section-eyebrow reveal">Simple pricing</div>
    <h2 class="section-h2 reveal reveal-delay-1">PAY FOR WHAT<br>YOU NEED</h2>
    <p class="section-sub reveal reveal-delay-2">Phone number included on every plan. 14-day free trial. No credit card required. No setup fee. No per-call charges. Ever.</p>
    <div class="pricing-grid">
      <div class="price-card reveal">
        <div class="price-name">Solo</div>
        <div class="price-amount"><span class="price-dollar">\$</span><span class="price-num">129</span><span class="price-period">/mo</span></div>
        <p class="price-desc">The solo operator's secret weapon. Captures every call, books every job.</p>
        <hr class="price-divider">
        <ul class="price-features">
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>150 AI-handled calls/month</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>1 staff member</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>1 resource / station</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Phone number included</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>SMS confirmations</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Customer CRM</li>
        </ul>
        <a href="/dashboard" class="price-btn outline">Start free trial</a>
      </div>
      <div class="price-card featured reveal reveal-delay-1">
        <div class="price-name">Growth</div>
        <div class="price-amount"><span class="price-dollar">\$</span><span class="price-num">279</span><span class="price-period">/mo</span></div>
        <p class="price-desc">Your full front desk. Staff matching, visual schedule, calendar sync, and knowledge base — all included.</p>
        <hr class="price-divider">
        <ul class="price-features">
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>500 AI-handled calls/month</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Up to 5 staff members</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Up to 3 resources / stations</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Everything in Solo</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Visual schedule for your whole team</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Google Calendar sync</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Knowledge base (PDF/text)</li>
        </ul>
        <a href="/dashboard" class="price-btn filled">Start free trial</a>
      </div>
      <div class="price-card reveal reveal-delay-2">
        <div class="price-name">Professional</div>
        <div class="price-amount"><span class="price-dollar">\$</span><span class="price-num">449</span><span class="price-period">/mo</span></div>
        <p class="price-desc">High-volume teams and growing businesses. Advanced analytics that show you where your business is winning and where it's leaking.</p>
        <hr class="price-divider">
        <ul class="price-features">
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>2,000 calls/month</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Unlimited staff members</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Unlimited stations</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Everything in Growth</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Advanced analytics &amp; business trends</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Custom AI vocabulary</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Priority support</li>
        </ul>
        <a href="/dashboard" class="price-btn outline">Start free trial</a>
      </div>
      <div class="price-card reveal reveal-delay-2" style="border-color:rgba(245,158,11,0.3);background:linear-gradient(180deg,rgba(245,158,11,0.06) 0%,var(--bg3) 100%)">
        <div class="price-name" style="color:var(--amber)">Enterprise</div>
        <div class="price-amount"><span class="price-dollar">\$</span><span class="price-num" style="color:var(--amber)">1,200</span><span class="price-period">+/mo</span></div>
        <p class="price-desc">Multi-location, franchise, or agency. White-label ready. Custom AI persona. Dedicated support.</p>
        <hr class="price-divider">
        <ul class="price-features">
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Everything in Professional</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Multiple locations / tenants</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>White-label dashboard</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Custom AI voice &amp; persona</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Dedicated account support</li>
          <li><div class="check"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></div>Custom integrations &amp; SLA</li>
        </ul>
        <a href="mailto:daledemott@gmail.com" class="price-btn outline" style="border-color:rgba(245,158,11,0.3);color:var(--amber)">Talk to us</a>
      </div>
    </div>
    <p class="trial-note reveal">All plans include a <span>14-day free trial</span>. No credit card required. No setup fee. No per-call charges. Cancel anytime.</p>
  </div>
</section>

<!-- SUPPORTED BUSINESSES -->
<section class="section" id="businesses" style="padding-top:0;">
  <div class="section-inner">
    <div class="section-eyebrow reveal">Industries</div>
    <h2 class="section-h2 reveal reveal-delay-1">BUILT FOR YOUR<br>KIND OF BUSINESS</h2>
    <p class="section-sub reveal reveal-delay-2">29 templates across 6 categories. Each uses the right words, the right defaults, and the right booking logic for your trade.</p>
    <div class="biz-grid reveal reveal-delay-2">
      <div class="biz-chip">Mobile Tire Service</div><div class="biz-chip">Tire Shop</div>
      <div class="biz-chip">Auto Repair</div><div class="biz-chip">Oil &amp; Lube</div>
      <div class="biz-chip">Body Shop</div><div class="biz-chip">Detailing Studio</div>
      <div class="biz-chip">Hair Salon</div><div class="biz-chip">Barbershop</div>
      <div class="biz-chip">Nail Salon</div><div class="biz-chip">Spa &amp; Massage</div>
      <div class="biz-chip">Gym &amp; Fitness</div><div class="biz-chip">Personal Training</div>
      <div class="biz-chip">Yoga Studio</div><div class="biz-chip">Plumbing</div>
      <div class="biz-chip">HVAC</div><div class="biz-chip">Electrician</div>
      <div class="biz-chip">Landscaping</div><div class="biz-chip">Photography</div>
      <div class="biz-chip">Real Estate</div><div class="biz-chip">Restaurant</div>
    </div>
  </div>
</section>

<!-- CTA BAND -->
<section class="cta-band">
  <h2 class="cta-band-h reveal">YOUR NEXT CALL<br>IS ABOUT TO<br><span style="color:var(--blue-lt)">GET ANSWERED.</span></h2>
  <p class="cta-band-sub reveal reveal-delay-1">Sign up in two minutes. Finish the wizard. Call your new number and hear your AI secretary pick up. It's that fast.</p>
  <div class="cta-band-actions reveal reveal-delay-2">
    <a href="/dashboard" class="btn-hero">Get started — it's free<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
    <div class="cta-number">
      <span class="cta-number-label">Try it live →</span>
      <span style="color:var(--blue-lt)">(630) 397-0194</span>
    </div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <div class="footer-logo">SECRETARY HQ</div>
  <div class="footer-links">
    <a href="#">Privacy</a>
    <a href="#">Terms</a>
    <a href="#">Contact</a>
    <a href="#">Docs</a>
  </div>
  <div class="footer-copy">© 2026 Secretary HQ. All rights reserved.</div>
</footer>

<script>
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

let seconds = 221;
const timer = document.getElementById('callTimer');
if (timer) {
  setInterval(() => {
    seconds++;
    const m = Math.floor(seconds/60).toString().padStart(2,'0');
    const s = (seconds%60).toString().padStart(2,'0');
    timer.textContent = m+':'+s;
  }, 1000);
}
</script>
`;

export default function LandingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // If already logged in, redirect to dashboard
    const token = localStorage.getItem('authToken');
    if (token) {
      router.replace('/dashboard');
      return;
    }
    setChecked(true);
  }, [router]);

  useEffect(() => {
    if (!checked) return;
    // Set up intersection observer for reveal animations
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

    // Call timer
    let seconds = 221;
    const timer = document.getElementById('callTimer');
    const interval = timer
      ? setInterval(() => {
          seconds++;
          const m = Math.floor(seconds / 60)
            .toString()
            .padStart(2, '0');
          const s = (seconds % 60).toString().padStart(2, '0');
          timer.textContent = m + ':' + s;
        }, 1000)
      : null;

    return () => {
      observer.disconnect();
      if (interval) clearInterval(interval);
    };
  }, [checked]);

  // Don't flash landing page for logged-in users
  if (!checked) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />
    </>
  );
}
