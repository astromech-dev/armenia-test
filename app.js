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

function newState(length) {
  return {
    answers: new Array(length).fill(null),
    score: 0,
    answered: 0
  };
}

// Learning mode = all questions, shuffled once per init / reset.
// Test mode = random 33 picked from the full pool.
function buildLearnQuestions() { return shuffle(ORIGINAL_QUESTIONS); }
function buildTestQuestions() { return shuffle(ORIGINAL_QUESTIONS).slice(0, TEST_QUESTION_COUNT); }

const modeData = {
  learn: { questions: buildLearnQuestions(), state: null },
  test:  { questions: buildTestQuestions(),  state: null }
};
modeData.learn.state = newState(modeData.learn.questions.length);
modeData.test.state  = newState(modeData.test.questions.length);

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

    if (currentMode === 'learn' && q.article && ARTICLES[q.article]) {
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

    quizEl.appendChild(card);
  });

  updateProgress();
  if (currentMode === 'test') testPoolFresh = false;
}

function answer(qi, oi) {
  if (state.answers[qi] !== null) return;
  state.answers[qi] = oi;
  if (oi === questions[qi].correct) state.score++;
  state.answered++;
  render();

  if (state.answered === questions.length) {
    showSummary();
  } else {
    setTimeout(() => scrollToQuestion(qi + 1), 220);
  }
}

function scrollToQuestion(idx) {
  const el = document.getElementById(`q${idx}`);
  if (!el) return;
  const sticky = document.querySelector('.sticky-controls');
  const headerHeight = sticky ? sticky.getBoundingClientRect().height : 0;
  // Extra buffer so the question NUMBER and TEXT are clearly visible below the sticky header,
  // not just the answer options.
  const buffer = 32;
  const top = el.getBoundingClientRect().top + window.pageYOffset - headerHeight - buffer;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function updateProgress() {
  scoreEl.textContent = `${state.score} / ${state.answered}`;
  counterEl.textContent = `${state.answered} / ${questions.length}`;
  progressFill.style.width = `${(state.answered / questions.length) * 100}%`;
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
  const anyProgress = modeData.learn.state.answered > 0 || modeData.test.state.answered > 0;
  if (!anyProgress || confirm('Սկսել նորից? / Начать заново?')) {
    // Reshuffle learn order and pick a fresh 33 for the test. Clear both states.
    modeData.learn.questions = buildLearnQuestions();
    modeData.test.questions  = buildTestQuestions();
    modeData.learn.state = newState(modeData.learn.questions.length);
    modeData.test.state  = newState(modeData.test.questions.length);
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
  questions = modeData[mode].questions;
  state = modeData[mode].state;

  if (mode === 'test') {
    document.body.classList.add('test-mode');
  } else {
    document.body.classList.remove('test-mode');
  }
  modeButtons.forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}

  render();
  if (state.answered === questions.length) {
    showSummary(false);
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function applyMode(mode, opts) {
  if (mode !== 'learn' && mode !== 'test') mode = 'learn';
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

