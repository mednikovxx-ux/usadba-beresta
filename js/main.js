/* ==========================================================================
   Усадьба Береста — видео-тур с 5 остановками, шапка, меню, появление текста.

   Как работает видео: у каждого экрана свой ключевой кадр (data-frame).
   Скролл выбирает остановку, а видео само доигрывает переход до неё
   в своём темпе — вперёд или назад. Скролл кадр в кадр не привязан.
   ========================================================================== */
(() => {
  'use strict';

  const FRAME_COUNT = 124;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.getElementById('site-header');
  const headerH = () => header.offsetHeight;

  /* ---------------------------------------------------------------------
     1. Кадры видео
     --------------------------------------------------------------------- */
  const canvas = document.getElementById('bg-video');
  const ctx = canvas.getContext('2d', { alpha: false });
  const scenes = [...document.querySelectorAll('.scene[data-frame]')].map((el) => ({
    el,
    frame: Number(el.dataset.frame),
    focus: parseFloat(el.dataset.focus || '0.5'),
  }));

  const useMobileSet = () => window.innerWidth < 768 || (navigator.connection && navigator.connection.saveData);
  let setName = useMobileSet() ? 'mobile' : 'desktop';
  let frames = [];
  let poster = null;

  const pad = (n) => String(n).padStart(4, '0');

  function loadSet(set) {
    frames = new Array(FRAME_COUNT + 1);
    poster = new Image();
    poster.src = set === 'mobile' ? 'assets/video/poster-mobile.jpg' : 'assets/video/poster.jpg';
    poster.decode().then(() => { needsDraw = true; }).catch(() => {});

    // Сначала первый переход (до бани), потом остальное по порядку
    let cursor = 1;
    const next = () => {
      if (cursor > FRAME_COUNT || set !== setName) return;
      const n = cursor++;
      const img = new Image();
      img.decoding = 'async';
      img.src = `assets/video/frames-${set}/${pad(n)}.webp`;
      img.decode()
        .then(() => { if (set === setName) { frames[n] = img; if (n === Math.round(current)) needsDraw = true; } })
        .catch(() => {})
        .finally(next);
    };
    for (let k = 0; k < 6; k++) next();
  }

  function nearestFrame(n) {
    if (frames[n]) return frames[n];
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (frames[n - d]) return frames[n - d];
      if (frames[n + d]) return frames[n + d];
    }
    return poster && poster.naturalWidth ? poster : null;
  }

  let cw = 0, ch = 0;
  function resizeCanvas() {
    // Кадры 1440 px шириной: холст крупнее не нужен — так рисование лёгкое и стабильно 60 к/с
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(dpr, 1600 / Math.max(window.innerWidth, window.innerHeight * 16 / 9));
    cw = canvas.width = Math.round(window.innerWidth * Math.max(1, k));
    ch = canvas.height = Math.round(window.innerHeight * Math.max(1, k));
    needsDraw = true;
  }

  // Как object-fit: cover, со сдвигом по focusX
  function draw(img, focusX) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, (cw - dw) * focusX, (ch - dh) / 2, dw, dh);
  }

  /* ---------------------------------------------------------------------
     2. Остановка по скроллу и «доигрывание» видео
     --------------------------------------------------------------------- */
  let stop = 0;                       // индекс текущей остановки
  let current = scenes[0].frame;      // кадр, который сейчас на экране (дробный)
  let focus = scenes[0].focus;
  let needsDraw = true, lastDrawn = -1, lastFocus = -1;

  // Остановка — экран, который занимает середину окна
  function stopFromScroll() {
    const line = window.scrollY + headerH() + (window.innerHeight - headerH()) * 0.5;
    let idx = 0;
    scenes.forEach((s, i) => { if (s.el.offsetTop <= line) idx = i; });
    return idx;
  }

  // Видео идёт с родной скоростью ролика (24 к/с) — ровно, как обычное видео.
  // Только короткий разгон в начале и торможение в конце, чтобы не было толчка.
  // Если в процессе листнули в другую сторону — видео мягко разворачивается.
  const VMAX = 24;               // кадров в секунду — скорость исходного видео
  const ACCEL = VMAX / 0.25;     // разгон за 0,25 с
  const DECEL = VMAX / 0.3;      // торможение за 0,3 с
  const VMIN = 4;                // у самой остановки не «ползёт»
  let vel = 0, lastNow = 0;

  function tick(now) {
    const s = scenes[stop];
    const target = s.frame;
    const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0);
    lastNow = now;

    if (reduceMotion.matches) {
      current = target; vel = 0;
    } else {
      const rem = target - current;
      if (Math.abs(rem) < 0.02 && Math.abs(vel) < VMIN + 0.01) {
        current = target; vel = 0;
      } else {
        const dir = Math.sign(rem);
        const brakeDist = (vel * vel) / (2 * DECEL);
        if (vel * dir < 0) vel += dir * DECEL * dt;                       // разворот
        else if (brakeDist >= Math.abs(rem)) vel = dir * Math.max(VMIN, Math.abs(vel) - DECEL * dt); // торможение
        else vel = dir * Math.min(VMAX, Math.abs(vel) + ACCEL * dt);     // разгон / ход
        current += vel * dt;
        if (Math.sign(target - current) !== dir && vel * dir > 0) { current = target; vel = 0; }
      }
    }

    // Кадрирование на телефоне плавно смещается к нужной стороне
    const fd = s.focus - focus;
    focus = Math.abs(fd) < 0.001 ? s.focus : focus + fd * 0.06;

    // Между соседними кадрами — плавное перетекание: в исходнике всего 24 к/с,
    // и при неспешном переходе без смешивания кадры заметно «щёлкают»
    const pos = Math.min(FRAME_COUNT, Math.max(1, current));
    const n = Math.floor(pos);
    const frac = Math.round((pos - n) * 32) / 32;
    const f = Math.round(focus * 1000) / 1000;
    const key = n + frac / 100;
    if (needsDraw || key !== lastDrawn || f !== lastFocus) {
      const img = nearestFrame(n);
      if (img) {
        draw(img, f);
        const nextImg = frac > 0 && n < FRAME_COUNT ? frames[n + 1] : null;
        if (nextImg) {
          ctx.globalAlpha = frac;
          draw(nextImg, f);
          ctx.globalAlpha = 1;
        }
        lastDrawn = frames[n] && (frac === 0 || nextImg) ? key : -1;
        lastFocus = f;
        needsDraw = false;
      }
    }

    // Блок остановки появляется сразу, вместе со стартом видео
    scenes.forEach((sc, i) => {
      if (sc.el.id === 'booking' && sc.el.classList.contains('is-active')) return; // форму не прячем
      sc.el.classList.toggle('is-active', i === stop);
    });

    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------------------
     3. Секции после видео (.reveal, один раз)
     --------------------------------------------------------------------- */
  const revealObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

  /* ---------------------------------------------------------------------
     4. Шапка: тень, активный пункт меню
     --------------------------------------------------------------------- */
  const hint = document.querySelector('.scroll-hint');
  const navLinks = [...document.querySelectorAll('.nav-list a')];
  const navSections = navLinks.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);

  function updateNav() {
    const line = headerH() + window.innerHeight * 0.4;
    let activeId = null;
    navSections.forEach((sec) => {
      const r = sec.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) activeId = sec.id;
    });
    navLinks.forEach((a) => {
      const on = a.getAttribute('href') === '#' + activeId;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
  }

  let queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const y = window.scrollY;
      header.classList.toggle('is-scrolled', y > 40);
      if (hint) hint.classList.toggle('is-hidden', y > 80);
      const next = stopFromScroll();
      if (next !== stop && reduceMotion.matches) {
        // Без движения: смена остановки плавной прозрачностью
        canvas.classList.add('is-fading');
        setTimeout(() => { stop = next; needsDraw = true; canvas.classList.remove('is-fading'); }, 300);
      } else {
        stop = next;
      }
      updateNav();
    });
  }

  /* ---------------------------------------------------------------------
     5. Мобильное меню
     --------------------------------------------------------------------- */
  const burger = document.querySelector('.burger');
  const menu = document.getElementById('mobile-menu');
  const closeBtn = menu.querySelector('.mobile-menu__close');

  function openMenu() {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    document.body.classList.add('menu-open');
    burger.setAttribute('aria-expanded', 'true');
    closeBtn.focus();
  }
  function closeMenu(restoreFocus = true) {
    menu.classList.remove('is-open');
    document.body.classList.remove('menu-open');
    burger.setAttribute('aria-expanded', 'false');
    setTimeout(() => { menu.hidden = true; }, reduceMotion.matches ? 0 : 300);
    if (restoreFocus) burger.focus();
  }
  burger.addEventListener('click', openMenu);
  closeBtn.addEventListener('click', () => closeMenu());
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => closeMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Tab') {
      const items = [...menu.querySelectorAll('a, button')];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.matchMedia('(min-width: 1024px)').addEventListener('change', (m) => { if (m.matches && !menu.hidden) closeMenu(false); });

  /* ---------------------------------------------------------------------
     6. Старт
     --------------------------------------------------------------------- */
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeCanvas();
      if (!useMobileSet() && setName === 'mobile') { setName = 'desktop'; loadSet('desktop'); }
      onScroll();
    }, 150);
  });
  window.addEventListener('scroll', onScroll, { passive: true });

  resizeCanvas();
  loadSet(setName);
  stop = stopFromScroll();
  current = scenes[stop].frame;   // при загрузке с середины страницы — сразу нужный кадр
  focus = scenes[stop].focus;
  onScroll();
  requestAnimationFrame(tick);
})();
