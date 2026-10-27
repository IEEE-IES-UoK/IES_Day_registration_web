/* A small, self-contained winter atmosphere. No animation runs outside the hero. */
(() => {
  'use strict';

  const hero = document.getElementById('welcome');
  const canvas = document.getElementById('snowCanvas');
  if (!hero || !canvas) return;

  const context = canvas.getContext('2d', { alpha: true });
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverPreference = window.matchMedia('(hover: hover) and (pointer: fine)');
  let paused = motionPreference.matches;
  const initialBounds = hero.getBoundingClientRect();
  let inView = initialBounds.bottom > 0 && initialBounds.top < window.innerHeight;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let flakes = [];
  let pointerWind = 0;
  let breeze = 0;

  const random = (min, max) => min + Math.random() * (max - min);
  const running = () => !paused && inView && !document.hidden;

  function makeFlake(initial = false) {
    const roll = Math.random();
    const depth = roll < 0.58 ? 0 : roll < 0.91 ? 1 : 2;
    const scale = [0.5, 0.8, 1.15][depth];
    return {
      x: random(-28, width + 28),
      y: initial ? random(-12, height) : random(-35, -8),
      radius: random(0.8, 1.9) * scale,
      speed: random(15, 27) * scale,
      sway: random(4, 13) * scale,
      phase: random(0, Math.PI * 2),
      frequency: random(0.45, 0.85),
      opacity: random(0.24, 0.51) * scale,
      depth
    };
  }

  function paint() {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    for (const flake of flakes) {
      context.beginPath();
      context.globalAlpha = flake.opacity;
      context.fillStyle = flake.depth === 0 ? '#dceee6' : '#fffaf0';
      context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      context.fill();
      // A soft halo gives the closest flakes depth without an expensive blur filter.
      if (flake.depth === 2) {
        context.beginPath();
        context.globalAlpha = flake.opacity * 0.12;
        context.arc(flake.x, flake.y, flake.radius * 2.3, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  function animate(time) {
    frame = 0;
    if (!running()) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    elapsed += delta;
    // Two long waves make wind feel organic instead of moving in a repeating line.
    const wind = Math.sin(elapsed * 0.17) * 8 + Math.sin(elapsed * 0.39 + 1.2) * 3;
    breeze += (pointerWind - breeze) * (1 - Math.exp(-delta * 1.7));
    for (let index = 0; index < flakes.length; index++) {
      const flake = flakes[index];
      const depthScale = [0.48, 0.78, 1.12][flake.depth];
      const flutter = Math.cos(elapsed * flake.frequency + flake.phase) * flake.sway;
      flake.x += (wind * depthScale + flutter + breeze * depthScale) * delta;
      flake.y += flake.speed * delta;
      if (flake.x < -35) flake.x = width + 30;
      if (flake.x > width + 35) flake.x = -30;
      if (flake.y > height + 12) flakes[index] = makeFlake();
    }
    paint();
    frame = window.requestAnimationFrame(animate);
  }

  function updateMotion() {
    const active = running();
    hero.dataset.motion = active ? 'running' : 'paused';
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (active && context) frame = window.requestAnimationFrame(animate);
    else paint();
  }

  function resize() {
    if (!context) return;
    const bounds = hero.getBoundingClientRect();
    const nextWidth = Math.round(bounds.width);
    const nextHeight = Math.round(bounds.height);
    if (!nextWidth || !nextHeight) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    if (nextWidth === width && nextHeight === height && ratio === pixelRatio) return;
    const oldWidth = width;
    const oldHeight = height;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = ratio;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Around 30 flakes on a phone and 65 on a large laptop: plenty of breathing room.
    const count = Math.max(28, Math.min(100, Math.round((width * height) / 15000)));
    flakes = flakes.slice(0, count);
    for (const flake of flakes) {
      if (oldWidth) flake.x *= width / oldWidth;
      if (oldHeight) flake.y *= height / oldHeight;
    }
    while (flakes.length < count) flakes.push(makeFlake(true));
    paint();
  }

  motionPreference.addEventListener('change', event => {
    paused = event.matches;
    updateMotion();
  });
  document.addEventListener('visibilitychange', updateMotion);

  hero.addEventListener('pointermove', event => {
    if (!hoverPreference.matches || event.pointerType !== 'mouse' || !running()) return;
    const bounds = hero.getBoundingClientRect();
    pointerWind = ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5) * 14;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointerWind = 0; }, { passive: true });
  hoverPreference.addEventListener('change', () => { pointerWind = 0; });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      updateMotion();
    }, { threshold: 0 });
    observer.observe(hero);
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resize);
    observer.observe(hero);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();
  updateMotion();
})();
