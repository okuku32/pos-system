// The About page tour: for a visitor who doesn't scroll, the page glides from section to section by itself
// (ease-in-out), pausing on each so it can be read, until it has shown everything Kapu is. Each section fades and
// slides in as it arrives. The tour stops for good the moment the visitor scrolls, taps, clicks or presses a key,
// and never runs for people who prefer less motion.
import { useEffect, useState } from 'react';

const FIRST_WAIT = 6000; // the visitor reads the top first
const READ_TIME = 5500; // then a pause on each section
const GLIDE_MS = 1600; // each slide down
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // ease-in-out (cubic)
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const headerHeight = () => (document.querySelector('.os-header')?.getBoundingClientRect().height || 72) + 12;

// glide the page to y, smoothly (our own easing, so it's the same on every browser); stop() cancels it
function glide(y, done) {
  const from = window.scrollY;
  const distance = y - from;
  const start = performance.now();
  let frame = 0;
  const step = (now) => {
    const t = Math.min(1, (now - start) / GLIDE_MS);
    window.scrollTo({ top: from + distance * easeInOut(t), behavior: 'instant' });
    if (t < 1) frame = requestAnimationFrame(step);
    else done?.();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

// sections: a CSS selector for the parts of the page, in order. Returns { touring, stop }.
export function useAboutTour(sections, { enabled = true } = {}) {
  const [touring, setTouring] = useState(false);
  const [stopped, setStopped] = useState(false);

  // every section fades / slides in as it comes into view (ease-in-out)
  useEffect(() => {
    if (!enabled || reducedMotion() || typeof IntersectionObserver === 'undefined') return undefined;
    const parts = [...document.querySelectorAll(sections)];
    parts.forEach((part) => part.classList.add('os-reveal'));
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); seen.unobserve(entry.target); }
    }, { threshold: 0.12 });
    parts.forEach((part) => seen.observe(part));
    return () => { seen.disconnect(); parts.forEach((part) => part.classList.remove('os-reveal', 'in')); };
  }, [sections, enabled]);

  // the tour itself
  useEffect(() => {
    if (!enabled || stopped || reducedMotion()) return undefined;
    let timer = 0;
    let cancelGlide = null;
    let index = 0;
    let active = true;
    const end = () => {
      active = false;
      clearTimeout(timer);
      cancelGlide?.();
      setTouring(false);
    };
    const userMoved = () => { end(); setStopped(true); }; // the visitor took over: never again on this visit
    const next = () => {
      if (!active || document.hidden) { timer = setTimeout(next, READ_TIME); return; }
      const parts = [...document.querySelectorAll(sections)].filter((part) => part.getBoundingClientRect().top + window.scrollY > window.scrollY + headerHeight() + 40);
      const target = parts[0];
      if (!target || index > 30) { end(); setStopped(true); return; } // shown everything
      index += 1;
      setTouring(true);
      const y = target.getBoundingClientRect().top + window.scrollY - headerHeight();
      cancelGlide = glide(Math.min(y, document.documentElement.scrollHeight - window.innerHeight), () => { timer = setTimeout(next, READ_TIME); });
    };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    events.forEach((name) => window.addEventListener(name, userMoved, { passive: true, once: true }));
    timer = setTimeout(next, FIRST_WAIT);
    return () => {
      end();
      events.forEach((name) => window.removeEventListener(name, userMoved));
    };
  }, [sections, enabled, stopped]);

  return { touring, stop: () => setStopped(true) };
}
