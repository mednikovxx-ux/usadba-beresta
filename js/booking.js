/* ==========================================================================
   Усадьба Береста — бронирование: календарь дат, проверка формы, отправка.

   Модуль готов к подключению CRM: достаточно указать адреса API в
   BOOKING_CONFIG (или window.BERESTA_BOOKING до подключения скрипта).
   Контракт API описан в docs/booking-api.md.
   ========================================================================== */
(() => {
  'use strict';

  const BOOKING_CONFIG = Object.assign({
    // GET → { busy: ["2026-11-14", …] } — ночи, которые уже заняты.
    // Пока CRM нет — статичный файл. Потом: '/api/availability'
    availabilityUrl: 'data/availability.json',
    // POST заявки. null — демо-режим: заявка сохраняется в браузере.
    // Потом: '/api/bookings'
    bookingsUrl: null,
    minNights: 1,
    monthsAhead: 12,
    pricePerNight: null,   // число в рублях, когда появится цена
    maxGuests: null,       // число, когда будет известна вместимость
  }, window.BERESTA_BOOKING || {});

  const root = document.querySelector('[data-calendar]');
  const form = document.getElementById('booking-form');
  if (!root || !form) return;

  /* ---------- Даты ---------- */
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const sameDay = (a, b) => a && b && key(a) === key(b);
  const nightsBetween = (a, b) => Math.round((b - a) / 86400000);
  const human = (d) => `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + BOOKING_CONFIG.monthsAhead + 1, 0);

  // В конце месяца сразу показываем следующий — в текущем почти нечего выбрать
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
  const startMonth = daysLeft < 7 ? today.getMonth() + 1 : today.getMonth();

  const state = {
    view: new Date(today.getFullYear(), startMonth, 1),
    checkIn: null,
    checkOut: null,
    hover: null,
    focus: today,
    busy: new Set(),
  };

  /* ---------- Правила выбора ---------- */
  const isPast = (d) => d < today;
  const isBusy = (d) => state.busy.has(key(d));
  const canCheckIn = (d) => !isPast(d) && d <= lastDay && !isBusy(d);

  // Все ночи с заезда до дня перед выездом свободны
  function rangeFree(from, to) {
    for (let d = from; d < to; d = addDays(d, 1)) if (isBusy(d)) return false;
    return true;
  }
  function canCheckOut(d) {
    if (!state.checkIn || state.checkOut) return false;
    return d > state.checkIn && d <= addDays(lastDay, 1)
      && nightsBetween(state.checkIn, d) >= BOOKING_CONFIG.minNights
      && rangeFree(state.checkIn, d);
  }

  /* ---------- Отрисовка календаря ---------- */
  root.innerHTML = `
    <div class="calendar__head">
      <button type="button" class="calendar__nav" data-nav="-1" aria-label="Предыдущий месяц">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <p class="calendar__title" id="calendar-title" aria-live="polite"></p>
      <button type="button" class="calendar__nav" data-nav="1" aria-label="Следующий месяц">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <div class="calendar__grid" role="grid" aria-labelledby="calendar-title"></div>
    <div class="calendar__legend" aria-hidden="true">
      <span><i class="lg-sel"></i>Ваши даты</span>
      <span><i class="lg-busy"></i>Занято</span>
    </div>`;

  const grid = root.querySelector('.calendar__grid');
  const title = root.querySelector('.calendar__title');
  const prevBtn = root.querySelector('[data-nav="-1"]');
  const nextBtn = root.querySelector('[data-nav="1"]');
  const summary = document.getElementById('booking-summary');
  const inCheckIn = document.getElementById('check-in');
  const inCheckOut = document.getElementById('check-out');
  const datesError = document.getElementById('dates-error');

  function render() {
    const y = state.view.getFullYear(), m = state.view.getMonth();
    title.textContent = `${MONTHS[m]} ${y}`;
    prevBtn.disabled = y === today.getFullYear() && m === today.getMonth();
    nextBtn.disabled = new Date(y, m + 1, 1) > lastDay;

    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;     // понедельник — первый
    const days = new Date(y, m + 1, 0).getDate();
    const choosingOut = state.checkIn && !state.checkOut;
    const rangeEnd = state.checkOut || (choosingOut && state.hover && canCheckOut(state.hover) ? state.hover : null);

    let html = '<div role="row" style="display:contents">' + DOW.map((d) => `<span class="calendar__dow" role="columnheader">${d}</span>`).join('') + '</div>';
    html += '<div role="row" style="display:contents">';
    for (let i = 0; i < offset; i++) html += '<span role="gridcell"></span>';
    for (let n = 1; n <= days; n++) {
      const d = new Date(y, m, n);
      const k = key(d);
      const enabled = choosingOut ? (canCheckOut(d) || canCheckIn(d)) : canCheckIn(d);
      const cls = ['calendar__day'];
      if (sameDay(d, today)) cls.push('is-today');
      if (isBusy(d) && !(choosingOut && canCheckOut(d))) cls.push('is-busy');
      if (sameDay(d, state.checkIn)) { cls.push('is-start'); if (rangeEnd) cls.push('has-end'); }
      if (rangeEnd && sameDay(d, rangeEnd)) cls.push('is-end');
      if (state.checkIn && rangeEnd && d > state.checkIn && d < rangeEnd) cls.push('is-range');
      const selected = sameDay(d, state.checkIn) || sameDay(d, state.checkOut);
      let label = `${n} ${MONTHS_GEN[m]} ${y}`;
      if (isBusy(d)) label += ', занято';
      if (sameDay(d, state.checkIn)) label += ', заезд';
      if (sameDay(d, state.checkOut)) label += ', выезд';
      html += `<span role="gridcell" style="display:contents"><button type="button" class="${cls.join(' ')}" data-date="${k}"
        aria-label="${label}" aria-pressed="${selected}" ${enabled ? '' : 'disabled'}
        tabindex="${sameDay(d, state.focus) ? 0 : -1}">${n}</button></span>`;
    }
    html += '</div>';
    grid.innerHTML = html;

    // Если фокусная дата не в этом месяце — фокус на первый доступный день
    if (!grid.querySelector('[tabindex="0"]')) {
      const firstEnabled = grid.querySelector('.calendar__day:not([disabled])') || grid.querySelector('.calendar__day');
      if (firstEnabled) firstEnabled.tabIndex = 0;
    }
    renderSummary();
  }

  function renderSummary() {
    inCheckIn.value = state.checkIn ? key(state.checkIn) : '';
    inCheckOut.value = state.checkOut ? key(state.checkOut) : '';
    if (!state.checkIn) { summary.innerHTML = ''; return; }
    if (!state.checkOut) {
      summary.innerHTML = `<p class="booking-summary__dates">Заезд ${human(state.checkIn)} — теперь выберите дату выезда</p>`;
      return;
    }
    const n = nightsBetween(state.checkIn, state.checkOut);
    const nightsText = `${n} ${plural(n, 'ночь', 'ночи', 'ночей')}`;
    const price = BOOKING_CONFIG.pricePerNight
      ? `Стоимость проживания: ${(BOOKING_CONFIG.pricePerNight * n).toLocaleString('ru-RU')} ₽ за ${nightsText}`
      : `Стоимость: [Цена за ночь] × ${nightsText}`;
    summary.innerHTML = `
      <p class="booking-summary__dates">${human(state.checkIn)} — ${human(state.checkOut)} · ${nightsText}</p>
      <p class="booking-summary__ok"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Даты свободны</p>
      <p class="booking-summary__price">${price}</p>`;
  }

  /* ---------- Взаимодействие ---------- */
  function pick(d) {
    hideError(datesError);
    if (state.checkIn && !state.checkOut && canCheckOut(d)) {
      state.checkOut = d;
    } else if (canCheckIn(d)) {
      state.checkIn = d;
      state.checkOut = null;
    }
    state.focus = d;
    state.hover = null;
    render();
    const btn = grid.querySelector(`[data-date="${key(d)}"]`);
    if (btn) btn.focus();
  }

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.calendar__day');
    if (btn && !btn.disabled) pick(parse(btn.dataset.date));
  });

  grid.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.calendar__day');
    if (!btn || !state.checkIn || state.checkOut) return;
    const d = parse(btn.dataset.date);
    if (!sameDay(d, state.hover)) { state.hover = d; render(); }
  });
  grid.addEventListener('mouseleave', () => {
    if (state.hover) { state.hover = null; render(); }
  });

  // Стрелки — по дням и неделям, PageUp/PageDown — по месяцам
  grid.addEventListener('keydown', (e) => {
    const btn = e.target.closest('.calendar__day');
    if (!btn) return;
    const d = parse(btn.dataset.date);
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = null;
    if (moves[e.key]) next = addDays(d, moves[e.key]);
    else if (e.key === 'PageUp') next = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
    else if (e.key === 'PageDown') next = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    else if (e.key === 'Home') next = addDays(d, -((d.getDay() + 6) % 7));
    else if (e.key === 'End') next = addDays(d, 6 - ((d.getDay() + 6) % 7));
    if (!next) return;
    e.preventDefault();
    if (next < today) next = today;
    if (next > lastDay) next = lastDay;
    state.focus = next;
    state.view = new Date(next.getFullYear(), next.getMonth(), 1);
    render();
    const target = grid.querySelector(`[data-date="${key(next)}"]`);
    if (target) { target.tabIndex = 0; target.focus(); }
  });

  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    state.view = new Date(state.view.getFullYear(), state.view.getMonth() + Number(b.dataset.nav), 1);
    render();
  }));

  /* ---------- Занятые даты ---------- */
  async function loadAvailability() {
    if (!BOOKING_CONFIG.availabilityUrl) return;
    try {
      const url = new URL(BOOKING_CONFIG.availabilityUrl, location.href);
      url.searchParams.set('from', key(today));
      url.searchParams.set('to', key(lastDay));
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.busy = new Set(data.busy || []);
      if (data.minNights) BOOKING_CONFIG.minNights = data.minNights;
      if (data.pricePerNight) BOOKING_CONFIG.pricePerNight = data.pricePerNight;
      // Выбранные даты стали заняты — сбрасываем
      if (state.checkIn && (isBusy(state.checkIn) || (state.checkOut && !rangeFree(state.checkIn, state.checkOut)))) {
        state.checkIn = state.checkOut = null;
      }
      render();
    } catch (err) {
      console.warn('Не удалось загрузить занятые даты:', err);
    }
  }

  /* ---------- Проверка формы ---------- */
  const fields = {
    name: document.getElementById('bf-name'),
    phone: document.getElementById('bf-phone'),
    guests: document.getElementById('bf-guests'),
    email: document.getElementById('bf-email'),
    consent: document.getElementById('bf-consent'),
  };
  if (BOOKING_CONFIG.maxGuests) fields.guests.max = BOOKING_CONFIG.maxGuests;

  function showError(input, el, text) {
    el.textContent = text;
    el.hidden = false;
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function hideError(el, input) {
    el.hidden = true;
    el.textContent = '';
    if (input) input.removeAttribute('aria-invalid');
  }
  const errOf = (input) => document.getElementById(input.id + '-error');

  function normalizePhone(v) {
    let digits = v.replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
    if (digits.length === 10 && digits[0] === '9') digits = '7' + digits;
    return digits.length >= 10 && digits.length <= 15 ? '+' + digits : null;
  }

  function validate() {
    const problems = [];
    if (!state.checkIn || !state.checkOut) {
      showError(null, datesError, state.checkIn ? 'Выберите дату выезда в календаре.' : 'Выберите в календаре дату заезда и дату выезда.');
      problems.push(grid.querySelector('[tabindex="0"]'));
    } else hideError(datesError);

    const name = fields.name.value.trim();
    if (name.length < 2) { showError(fields.name, errOf(fields.name), 'Напишите, как к вам обращаться.'); problems.push(fields.name); }
    else hideError(errOf(fields.name), fields.name);

    if (!normalizePhone(fields.phone.value)) { showError(fields.phone, errOf(fields.phone), 'Проверьте номер: нужно 10–11 цифр, например +7 900 000-00-00.'); problems.push(fields.phone); }
    else hideError(errOf(fields.phone), fields.phone);

    const g = Number(fields.guests.value);
    const max = BOOKING_CONFIG.maxGuests;
    if (!Number.isInteger(g) || g < 1) { showError(fields.guests, errOf(fields.guests), 'Укажите количество гостей — хотя бы одного.'); problems.push(fields.guests); }
    else if (max && g > max) { showError(fields.guests, errOf(fields.guests), `В доме до ${max} гостей. Для большой компании позвоните нам.`); problems.push(fields.guests); }
    else hideError(errOf(fields.guests), fields.guests);

    const email = fields.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError(fields.email, errOf(fields.email), 'Проверьте почту — например, name@mail.ru. Или оставьте поле пустым.');
      document.getElementById('bf-extras').open = true;
      problems.push(fields.email);
    }
    else hideError(errOf(fields.email), fields.email);

    if (!fields.consent.checked) { showError(fields.consent, errOf(fields.consent), 'Без согласия мы не можем принять заявку.'); problems.push(fields.consent); }
    else hideError(errOf(fields.consent), fields.consent);

    return problems.filter(Boolean);
  }

  // Ошибка исчезает, как только поле исправлено
  Object.values(fields).forEach((input) => {
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
      if (input.getAttribute('aria-invalid') === 'true') validate();
    });
  });

  /* ---------- Отправка ---------- */
  function utm() {
    const p = new URLSearchParams(location.search);
    const out = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => { if (p.get(k)) out[k] = p.get(k); });
    return out;
  }

  function buildPayload() {
    const fd = new FormData(form);
    return {
      checkIn: key(state.checkIn),
      checkOut: key(state.checkOut),
      nights: nightsBetween(state.checkIn, state.checkOut),
      guests: Number(fd.get('guests')),
      name: String(fd.get('name')).trim(),
      phone: normalizePhone(String(fd.get('phone'))),
      email: String(fd.get('email') || '').trim() || null,
      services: fd.getAll('services'),
      comment: String(fd.get('comment') || '').trim() || null,
      consent: true,
      source: 'site',
      page: location.href,
      utm: utm(),
      createdAt: new Date().toISOString(),
    };
  }

  async function send(payload) {
    if (!BOOKING_CONFIG.bookingsUrl) {
      // Демо-режим: CRM ещё не подключена — заявка хранится только в этом браузере
      const item = { id: 'demo-' + Date.now(), status: 'new', ...payload };
      try {
        const list = JSON.parse(localStorage.getItem('beresta_bookings') || '[]');
        list.push(item);
        localStorage.setItem('beresta_bookings', JSON.stringify(list));
      } catch (e) { /* приватный режим — просто не сохраняем */ }
      console.info('[Береста] Демо-режим: заявка сохранена локально, CRM не подключена.', item);
      return item;
    }
    const res = await fetch(BOOKING_CONFIG.bookingsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 409) {
      const e = new Error('busy'); e.code = 'busy'; throw e;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const status = document.getElementById('form-status');
  const success = document.getElementById('booking-success');
  const successText = document.getElementById('booking-success-text');
  const submitBtn = form.querySelector('[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.hidden = true;
    const problems = validate();
    if (problems.length) { problems[0].focus(); return; }

    const payload = buildPayload();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляем…';
    try {
      await send(payload);
      const n = payload.nights;
      successText.textContent = `Спасибо, ${payload.name}. Заявка на ${human(state.checkIn)} — ${human(state.checkOut)} (${n} ${plural(n, 'ночь', 'ночи', 'ночей')}) у нас. Перезвоним на ${payload.phone}, чтобы подтвердить бронь.`;
      form.hidden = true;
      success.hidden = false;
      success.focus();
    } catch (err) {
      status.textContent = err.code === 'busy'
        ? 'Эти даты только что заняли. Выберите, пожалуйста, другие.'
        : 'Не получилось отправить заявку. Попробуйте еще раз или позвоните нам: [Телефон].';
      status.hidden = false;
      if (err.code === 'busy') loadAvailability();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Забронировать';
    }
  });

  document.getElementById('booking-again').addEventListener('click', () => {
    form.reset();
    state.checkIn = state.checkOut = null;
    render();
    success.hidden = true;
    form.hidden = false;
    grid.querySelector('[tabindex="0"]')?.focus();
  });

  // API для будущей CRM и отладки
  window.BerestaBooking = {
    config: BOOKING_CONFIG,
    reloadAvailability: loadAvailability,
    localBookings: () => { try { return JSON.parse(localStorage.getItem('beresta_bookings') || '[]'); } catch (e) { return []; } },
  };

  render();
  loadAvailability();
})();
