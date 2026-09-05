// Общая логика теста (используется и базовым, и расширенным тестом).
// Данные подключаются ОТДЕЛЬНО до этого файла:
//   articles.js          -> const ARTICLES, CONSTITUTION_URL
//   questions-*.js        -> const ORIGINAL_QUESTIONS
// Поведение полностью идентично прежней версии.

// Бейджи источников нужны только когда вопросы из разных источников.
const SHOW_BADGES = new Set(ORIGINAL_QUESTIONS.map(function (q) { return q.source; })).size > 1;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TEST_QUESTION_COUNT = 33;

// --- Сохранение прогресса и списка «на повторение» (localStorage) ---
// Ключи в хранилище неймспейсятся по тесту (data-test на <body>), чтобы банк из 33
// и банк из 135 вопросов не перетирали прогресс друг друга.
const TEST_ID = (document.body.dataset && document.body.dataset.test) || 'official';
const LS_ANSWERS = 'arm-' + TEST_ID + '-answers';
const LS_MARKS   = 'arm-' + TEST_ID + '-marks';

// Ключ вопроса — хеш армянского текста (FNV-1a, base36). По индексу в массиве
// хранить нельзя: добавление или перестановка вопроса сдвинула бы весь прогресс.
function hashKey(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

const QUESTION_KEYS = new Map();
ORIGINAL_QUESTIONS.forEach(function (q) { QUESTION_KEYS.set(q, hashKey(q.hy)); });
function keyOf(q) { return QUESTION_KEYS.get(q); }

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

// Ключи вопросов, которых больше нет в банке, отбрасываем — чтобы хранилище не росло.
const KNOWN_KEYS = new Set(ORIGINAL_QUESTIONS.map(keyOf));

let answersStore = {};
const savedAnswers = loadJSON(LS_ANSWERS, {});
Object.keys(savedAnswers).forEach(function (k) {
  if (KNOWN_KEYS.has(k) && typeof savedAnswers[k] === 'number') answersStore[k] = savedAnswers[k];
});

const marksStore = new Set(
  (loadJSON(LS_MARKS, []) || []).filter(function (k) { return KNOWN_KEYS.has(k); })
);

function saveAnswers() { saveJSON(LS_ANSWERS, answersStore); }
function saveMarks()   { saveJSON(LS_MARKS, Array.from(marksStore)); }

function newState(length) {
  return {
    answers: new Array(length).fill(null),
    score: 0,
    answered: 0
  };
}

// Learning mode = all questions in fixed source order (не перетасовывается,
// чтобы порядок не менялся при обновлении страницы).
// Test mode = random 33 picked from the full pool.
function buildLearnQuestions() { return ORIGINAL_QUESTIONS.slice(); }
// Список повторения — те же вопросы в том же порядке, только отмеченные.
function buildRepeatQuestions() {
  return ORIGINAL_QUESTIONS.filter(function (q) { return marksStore.has(keyOf(q)); });
}
function buildTestQuestions() { return shuffle(ORIGINAL_QUESTIONS).slice(0, TEST_QUESTION_COUNT); }

// Состояние обучения — производное от сохранённых ответов, а не отдельная память.
function stateFromStore(qs) {
  const st = newState(qs.length);
  qs.forEach(function (q, i) {
    const a = answersStore[keyOf(q)];
    if (typeof a !== 'number' || !q.options[a]) return;
    st.answers[i] = a;
    st.answered++;
    if (a === q.correct) st.score++;
  });
  return st;
}

const modeData = {
  learn:  { questions: buildLearnQuestions(),  state: null },
  repeat: { questions: buildRepeatQuestions(), state: null },
  test:   { questions: buildTestQuestions(),   state: null }
};
modeData.learn.state  = stateFromStore(modeData.learn.questions);
modeData.repeat.state = stateFromStore(modeData.repeat.questions);
modeData.test.state   = newState(modeData.test.questions.length);

// «Обучение» и «Повторить» — учебные режимы: общий прогресс, перевод,
// метки и блок статьи. Отличаются только тем, какие вопросы показаны.
function isStudyMode() { return currentMode === 'learn' || currentMode === 'repeat'; }

let currentMode = 'learn';
let questions = modeData[currentMode].questions;
let state = modeData[currentMode].state;

const quizEl = document.getElementById('quiz');
const scoreEl = document.getElementById('score');
const counterEl = document.getElementById('counter');
const progressFill = document.getElementById('progressFill');
const resetBtn = document.getElementById('resetBtn');

function render() {
  quizEl.innerHTML = '';

  if (questions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = 'Здесь пока пусто.<br>' +
      'В режиме «Обучение» под каждым вопросом есть кнопка ' +
      '<span class="es-pill">🔖 Добавить в повторение</span> — отмечайте ей всё, ' +
      'что хочется повторить. Вопросы с неверным ответом попадают сюда сами.';
    quizEl.appendChild(empty);
    updateProgress();
    return;
  }

  questions.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'question';
    card.id = `q${qi}`;

    const head = document.createElement('div');
    head.className = 'q-head';

    const num = document.createElement('div');
    num.className = 'q-num';
    num.textContent = `Вопрос ${qi + 1}`;
    head.appendChild(num);

    // Бейдж источника показывается только если в наборе больше одного типа
    // (официальный тест = все official → бейджи не нужны; расширенный = смешанный → нужны).
    if (SHOW_BADGES) {
      const badge = document.createElement('span');
      const isOfficial = q.source === 'official';
      badge.className = 'q-badge ' + (isOfficial ? 'official' : 'generated');
      badge.innerHTML = isOfficial
        ? 'Պաշտոնական<span class="badge-ru ru-only"> · Официальный</span>'
        : 'Գեներացված<span class="badge-ru ru-only"> · Сгенерирован</span>';
      badge.title = isOfficial
        ? 'Из постановления № 1040-Н (arlis.am)'
        : 'Сгенерирован по примеру / банку экзамена';
      head.appendChild(badge);
    }

    card.appendChild(head);

    const hy = document.createElement('div');
    hy.className = 'q-hy';
    hy.textContent = q.hy;
    card.appendChild(hy);

    const ru = document.createElement('div');
    ru.className = 'q-ru';
    ru.textContent = q.ru;
    card.appendChild(ru);

    const opts = document.createElement('div');
    opts.className = 'options';

    const userAnswer = state.answers[qi];

    q.options.forEach((opt, oi) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.type = 'button';

      const hySpan = document.createElement('span');
      hySpan.className = 'opt-hy';
      hySpan.textContent = `${oi + 1}) ${opt.hy}`;
      btn.appendChild(hySpan);

      const ruSpan = document.createElement('span');
      ruSpan.className = 'opt-ru';
      ruSpan.textContent = opt.ru;
      btn.appendChild(ruSpan);

      if (userAnswer !== null) {
        btn.disabled = true;
        if (oi === q.correct) {
          btn.classList.add('correct');
        } else if (oi === userAnswer) {
          btn.classList.add('wrong');
        } else {
          btn.classList.add('muted');
        }
      }

      btn.addEventListener('click', () => answer(qi, oi));
      opts.appendChild(btn);
    });

    card.appendChild(opts);

    if (userAnswer !== null) {
      const fb = document.createElement('div');
      const ok = userAnswer === q.correct;
      fb.className = 'feedback show ' + (ok ? 'ok' : 'err');
      const correctText = `${q.correct + 1}) ${q.options[q.correct].hy}`;
      fb.innerHTML = ok
        ? `Правильно`
        : `Неправильно. Правильный ответ: ${escapeHtml(correctText)}`;
      card.appendChild(fb);
    }

    if (isStudyMode() && q.article && ARTICLES[q.article]) {
      const det = document.createElement('details');
      det.className = 'article-info';
      const sum = document.createElement('summary');
      sum.textContent = `Статья ${q.article} Конституции РА`;
      det.appendChild(sum);
      const body = document.createElement('div');
      body.className = 'article-body';
      const para = document.createElement('p');
      para.textContent = ARTICLES[q.article];
      body.appendChild(para);
      const link = document.createElement('a');
      link.href = CONSTITUTION_URL;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Полный текст Конституции →';
      body.appendChild(link);
      det.appendChild(body);
      card.appendChild(det);
    }

    if (isStudyMode()) card.appendChild(makeMarkButton(q));

    quizEl.appendChild(card);
  });

  updateProgress();
  if (currentMode === 'test') testPoolFresh = false;
}

function answer(qi, oi) {
  if (state.answers[qi] !== null) return;
  const q = questions[qi];
  const ok = oi === q.correct;
  state.answers[qi] = oi;
  if (ok) state.score++;
  state.answered++;

  // Прогресс сохраняется в учебных режимах; «Самопроверка» — разовая попытка.
  if (isStudyMode()) {
    answersStore[keyOf(q)] = oi;
    saveAnswers();
    if (!ok && !marksStore.has(keyOf(q))) {
      marksStore.add(keyOf(q));
      saveMarks();
      updateRepeatCount();
    }
  }
  render();

  if (state.answered === questions.length) {
    showSummary();
  } else {
    setTimeout(() => scrollToQuestion(qi + 1), 220);
  }
}

function scrollToQuestion(idx, behavior) {
  const el = document.getElementById(`q${idx}`);
  if (!el) return;
  const sticky = document.querySelector('.sticky-controls');
  const headerHeight = sticky ? sticky.getBoundingClientRect().height : 0;
  // Extra buffer so the question NUMBER and TEXT are clearly visible below the sticky header,
  // not just the answer options.
  const buffer = 32;
  const top = el.getBoundingClientRect().top + window.pageYOffset - headerHeight - buffer;
  window.scrollTo({ top: Math.max(0, top), behavior: behavior || 'smooth' });
}

function updateProgress() {
  const total = questions.length;
  scoreEl.textContent = `${state.score} / ${state.answered}`;
  counterEl.textContent = `${state.answered} / ${total}`;
  progressFill.style.width = total ? `${(state.answered / total) * 100}%` : '0%';
}

function passingScore() {
  // Test mode keeps the official 17/33 threshold. Learning mode uses "more than half".
  return Math.floor(questions.length / 2) + 1;
}

function showSummary(scroll = true) {
  const existing = document.getElementById('summary');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'summary';
  div.id = 'summary';

  // В списке на повторение «проходного балла» нет — это тренировка, а не тест:
  // важно только, что уже запомнилось, а что осталось повторить.
  if (currentMode === 'repeat') {
    const wrong = questions.length - state.score;
    div.innerHTML = `
      <h2>Повторение пройдено</h2>
      <div class="result">${state.score} / ${questions.length}</div>
      <div class="note">${wrong
        ? `Правильно ${state.score}, с ошибкой ${wrong}. Уберите из списка то, что уже запомнили — остальное прогоните ещё раз.`
        : 'Все вопросы отвечены верно. Можно убрать их из списка.'}</div>
    `;

    if (state.score > 0) {
      const keepBtn = document.createElement('button');
      keepBtn.type = 'button';
      keepBtn.className = 'summary-action';
      keepBtn.textContent = `Убрать правильные из списка · ${state.score}`;
      keepBtn.addEventListener('click', () => {
        questions.forEach((q, i) => {
          if (state.answers[i] === q.correct) marksStore.delete(keyOf(q));
        });
        saveMarks();
        refreshRepeat();
      });
      div.appendChild(keepBtn);
    }

    if (wrong > 0) {
      const againBtn = document.createElement('button');
      againBtn.type = 'button';
      againBtn.className = 'summary-action secondary';
      againBtn.textContent = 'Пройти список заново';
      againBtn.addEventListener('click', () => {
        marksStore.forEach(k => { delete answersStore[k]; });
        saveAnswers();
        refreshRepeat();
      });
      div.appendChild(againBtn);
    }

    quizEl.appendChild(div);
    if (scroll) {
      setTimeout(() => div.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    }
    return;
  }

  const threshold = passingScore();
  const passed = state.score >= threshold;
  div.innerHTML = `
    <h2>Результат</h2>
    <div class="result">${state.score} / ${questions.length}</div>
    <div class="${passed ? 'pass' : 'fail'}">
      ${passed ? '✓ Тест пройден' : '✗ Тест не пройден'}
    </div>
    <div class="note">Проходной балл — ${threshold} и более</div>
  `;
  quizEl.appendChild(div);
  if (scroll) {
    setTimeout(() => div.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }
}

resetBtn.addEventListener('click', () => {
  const anyProgress = Object.keys(answersStore).length > 0 || modeData.test.state.answered > 0;
  const question = 'Սկսել նորից? / Начать заново?\n\nОтветы будут стёрты. Список на повторение сохранится.';
  if (!anyProgress || confirm(question)) {
    // Стираются только ответы; метки «на повторение» переживают сброс —
    // их чистит отдельная кнопка в строке фильтра.
    answersStore = {};
    saveAnswers();
    modeData.learn.questions  = buildLearnQuestions();
    modeData.repeat.questions = buildRepeatQuestions();
    modeData.test.questions   = buildTestQuestions();
    modeData.learn.state  = stateFromStore(modeData.learn.questions);
    modeData.repeat.state = stateFromStore(modeData.repeat.questions);
    modeData.test.state   = newState(modeData.test.questions.length);
    questions = modeData[currentMode].questions;
    state = modeData[currentMode].state;
    testPoolFresh = true;  // next switch to test mode should show "Собираем вопросы…"
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// Mode toggle: "learn" shows Armenian + Russian, "test" shows Armenian only.
const MODE_KEY = 'arm-test-mode';
const modeButtons = document.querySelectorAll('.mode-btn');
const loaderEl = document.getElementById('loader');

// Loader is shown ONLY when the test pool is freshly generated:
// - On the very first switch to test mode in this session
// - After the Reset button is clicked
// Subsequent toggles learn↔test keep the same 33 questions, so no loader.
let testPoolFresh = true;

function showLoader() {
  if (loaderEl) {
    loaderEl.classList.add('show');
    loaderEl.setAttribute('aria-hidden', 'false');
  }
}
function hideLoader() {
  if (loaderEl) {
    loaderEl.classList.remove('show');
    loaderEl.setAttribute('aria-hidden', 'true');
  }
}

function doApplyMode(mode) {
  currentMode = mode;

  // Список повторения собирается заново при каждом входе — метки могли
  // измениться в обучении с прошлого раза.
  if (mode === 'repeat') {
    modeData.repeat.questions = buildRepeatQuestions();
    modeData.repeat.state = stateFromStore(modeData.repeat.questions);
  }

  questions = modeData[mode].questions;
  state = modeData[mode].state;

  document.body.classList.toggle('test-mode', mode === 'test');
  document.body.classList.toggle('repeat-mode', mode === 'repeat');
  modeButtons.forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}

  render();
  if (questions.length && state.answered === questions.length) {
    showSummary(false);
  }
  scrollToResumePoint();
}

// Возврат к тому месту, где остановились: первый неотвеченный вопрос.
function scrollToResumePoint() {
  if (!isStudyMode() || state.answered === 0 || state.answered === questions.length) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  const next = state.answers.indexOf(null);
  if (next < 0) { window.scrollTo({ top: 0, behavior: 'auto' }); return; }
  // Мгновенно и с уточнением: высота карточек меняется после подгрузки
  // шрифтов, поэтому одного прыжка не хватает.
  scrollToQuestion(next, 'auto');
  requestAnimationFrame(() => scrollToQuestion(next, 'auto'));
  setTimeout(() => scrollToQuestion(next, 'auto'), 150);
}

function applyMode(mode, opts) {
  if (mode !== 'learn' && mode !== 'repeat' && mode !== 'test') mode = 'learn';
  const skipLoader = opts && opts.skipLoader;
  if (mode === currentMode && !skipLoader) return;  // already in this mode — no-op
  const shouldShowLoader = mode === 'test' && testPoolFresh && !skipLoader;
  if (shouldShowLoader) {
    showLoader();
    setTimeout(() => {
      doApplyMode(mode);
      hideLoader();
    }, 900);
  } else {
    doApplyMode(mode);
  }
}

modeButtons.forEach(b => {
  b.addEventListener('click', () => applyMode(b.dataset.mode));
});

// --- Переключатель русского перевода (работает в режиме «Обучение»;
// в «Самопроверке» перевод скрыт всегда правилами body.test-mode). ---
const RU_KEY = 'arm-test-ru';
const ruBtn = document.getElementById('ruBtn');

function applyRu(show) {
  document.body.classList.toggle('no-ru', !show);
  if (ruBtn) ruBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
  try { localStorage.setItem(RU_KEY, show ? '1' : '0'); } catch (e) {}
}

let savedRu = true;
try { savedRu = localStorage.getItem(RU_KEY) !== '0'; } catch (e) {}
applyRu(savedRu);

if (ruBtn) {
  ruBtn.addEventListener('click', () => {
    applyRu(ruBtn.getAttribute('aria-pressed') !== 'true');
  });
}

// --- Список «на повторение»: метка на карточке + режим «Повторить» ---
const repeatActionsEl = document.getElementById('repeatActions');
const repeatRetryBtn = document.getElementById('repeatRetryBtn');
const repeatClearBtn = document.getElementById('repeatClearBtn');
const repeatCountEl = document.getElementById('repeatCount');

function makeMarkButton(q) {
  const key = keyOf(q);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mark-btn';
  const icon = document.createElement('span');
  icon.className = 'mark-icon';
  icon.textContent = '🔖';
  const text = document.createElement('span');
  text.className = 'mark-text';
  btn.appendChild(icon);
  btn.appendChild(text);

  // Иконка = маркер «отмечено»: без метки её нет, с меткой она появляется.
  function sync(marked) {
    btn.setAttribute('aria-pressed', marked ? 'true' : 'false');
    icon.hidden = !marked;
    text.textContent = marked ? 'В повторении — убрать' : 'Добавить в повторение';
    btn.title = marked
      ? 'Убрать вопрос из режима «Повторить»'
      : 'Добавить вопрос в режим «Повторить»';
  }
  sync(marksStore.has(key));

  btn.addEventListener('click', () => {
    const marked = !marksStore.has(key);
    if (marked) marksStore.add(key); else marksStore.delete(key);
    saveMarks();
    sync(marked);
    updateRepeatCount();
    // Список намеренно НЕ перестраивается: карточка не должна исчезать под
    // пальцем. Снятая метка учтётся при следующем входе в режим «Повторить».
  });
  return btn;
}

// Счётчик во вкладке «Повторить» — единственное место, где виден размер списка.
function updateRepeatCount() {
  const hasMarks = marksStore.size > 0;
  if (repeatCountEl) repeatCountEl.textContent = marksStore.size;
  if (repeatRetryBtn) repeatRetryBtn.disabled = !hasMarks;
  if (repeatClearBtn) repeatClearBtn.disabled = !hasMarks;
}

// Пересборка режима повторения после правки списка изнутри него самого.
function refreshRepeat() {
  updateRepeatCount();
  if (currentMode !== 'repeat') return;
  modeData.repeat.questions = buildRepeatQuestions();
  modeData.repeat.state = stateFromStore(modeData.repeat.questions);
  questions = modeData.repeat.questions;
  state = modeData.repeat.state;
  render();
  if (questions.length && state.answered === questions.length) showSummary(false);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

if (repeatRetryBtn) {
  repeatRetryBtn.addEventListener('click', () => {
    const answered = Array.from(marksStore).filter(k => typeof answersStore[k] === 'number');
    if (!answered.length) return;
    if (!confirm('Пройти вопросы на повторение заново?\n\nОтветы на остальные вопросы сохранятся.')) return;
    answered.forEach(k => { delete answersStore[k]; });
    saveAnswers();
    refreshRepeat();
  });
}

if (repeatClearBtn) {
  repeatClearBtn.addEventListener('click', () => {
    if (!marksStore.size) return;
    if (!confirm('Очистить список на повторение?\n\nОтветы на вопросы сохранятся.')) return;
    marksStore.clear();
    saveMarks();
    refreshRepeat();
  });
}

updateRepeatCount();

let savedMode = 'learn';
try { savedMode = localStorage.getItem(MODE_KEY) || 'learn'; } catch (e) {}
// Initial mode set without loader — page already feels like a fresh load.
applyMode(savedMode, { skipLoader: true });


// --- Автоподсчёт количества вопросов в интерфейсе (без хардкода) ---
function pluralVoprosy(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'вопрос';
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return 'вопроса';
  return 'вопросов';
}

function fillFooter() {
  const footer = document.getElementById('footerCounts');
  if (!footer) return;
  const total = ORIGINAL_QUESTIONS.length;
  const word = pluralVoprosy(total);
  if (total <= TEST_QUESTION_COUNT) {
    const pass = Math.floor(total / 2) + 1;
    footer.textContent = `${total} ${word} · проходной балл — ${pass} и более`;
  } else {
    const passTest = Math.floor(TEST_QUESTION_COUNT / 2) + 1;
    footer.textContent = `${total} ${word} · в режиме теста — ${TEST_QUESTION_COUNT} случайных, проходной ${passTest} из ${TEST_QUESTION_COUNT}`;
  }
}
fillFooter();

// Дата последнего обновления (из общего конфига config.js).
function fillLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el && typeof LAST_UPDATED !== 'undefined') el.textContent = LAST_UPDATED;
}
fillLastUpdated();

// Число вопросов в промо-кнопке перехода на ДРУГОЙ тест.
// Данные другого теста на этой странице не загружены, поэтому счётчик берётся
// из общего конфига TEST_COUNTS (config.js) по ключу data-count.
function fillTransitionCount() {
  const btn = document.querySelector('.transition-btn[data-count]');
  if (!btn || typeof TEST_COUNTS === 'undefined') return;
  const n = TEST_COUNTS[btn.getAttribute('data-count')];
  if (n == null) return;
  const countEl = btn.querySelector('.tb-count');
  const wordEl = btn.querySelector('.tb-word');
  if (countEl) countEl.textContent = n;
  if (wordEl) wordEl.textContent = pluralVoprosy(n);
}
fillTransitionCount();

