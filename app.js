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
const LS_FILTER  = 'arm-' + TEST_ID + '-filter';

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
const QUESTION_NUMBERS = new Map();
ORIGINAL_QUESTIONS.forEach(function (q, i) {
  QUESTION_KEYS.set(q, hashKey(q.hy));
  QUESTION_NUMBERS.set(q, i + 1);
});
function keyOf(q) { return QUESTION_KEYS.get(q); }
// Номер вопроса в полном списке — в режиме повторения он не совпадает с позицией.
function originalNumberOf(q) { return QUESTION_NUMBERS.get(q); }

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

// 'all' — весь банк, 'repeat' — только отмеченные «на повторение».
let learnFilter = loadJSON(LS_FILTER, 'all') === 'repeat' ? 'repeat' : 'all';
if (learnFilter === 'repeat' && marksStore.size === 0) learnFilter = 'all';

function saveAnswers() { saveJSON(LS_ANSWERS, answersStore); }
function saveMarks()   { saveJSON(LS_MARKS, Array.from(marksStore)); }
function saveFilter()  { saveJSON(LS_FILTER, learnFilter); }

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
function buildLearnQuestions() {
  if (learnFilter === 'repeat') {
    return ORIGINAL_QUESTIONS.filter(function (q) { return marksStore.has(keyOf(q)); });
  }
  return ORIGINAL_QUESTIONS.slice();
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
  learn: { questions: buildLearnQuestions(), state: null },
  test:  { questions: buildTestQuestions(),  state: null }
};
modeData.learn.state = stateFromStore(modeData.learn.questions);
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

  if (questions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = 'Список на повторение пуст.<br>' +
      'Отмечайте вопросы кнопкой <span class="es-pill">Повторить</span> — ' +
      'сюда же автоматически попадают те, где вы ошиблись.';
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
    const origNum = originalNumberOf(q);
    num.textContent = (currentMode === 'learn' && learnFilter === 'repeat' && origNum)
      ? `Вопрос ${qi + 1} (№ ${origNum} в списке)`
      : `Вопрос ${qi + 1}`;
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

    // В самопроверке — кнопка перевода этого одного вопроса.
    if (currentMode === 'test') {
      head.appendChild(makeRuButton(q, card));
    }

    // В обучении метка доступна всегда, в самопроверке — только после ответа:
    // до ответа она отвлекала бы от «экзаменационного» вида.
    if (currentMode === 'learn' || state.answers[qi] !== null) {
      head.appendChild(makeMarkButton(q));
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
  const q = questions[qi];
  const ok = oi === q.correct;
  state.answers[qi] = oi;
  if (ok) state.score++;
  state.answered++;

  // Прогресс сохраняется только в обучении: «Самопроверка» — разовая попытка.
  if (currentMode === 'learn') {
    answersStore[keyOf(q)] = oi;
    saveAnswers();
  }
  // А вот список на повторение пополняется в обоих режимах: промах на
  // самопроверке — такой же повод повторить вопрос.
  if (!ok && !marksStore.has(keyOf(q))) {
    marksStore.add(keyOf(q));
    saveMarks();
    updateRepeatCount();
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
  if (currentMode === 'learn' && learnFilter === 'repeat') {
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
        applyLearnFilter('repeat');
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
        applyLearnFilter('repeat');
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
    revealedRu.clear();
    modeData.learn.questions = buildLearnQuestions();
    modeData.test.questions  = buildTestQuestions();
    modeData.learn.state = stateFromStore(modeData.learn.questions);
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
  if (questions.length && state.answered === questions.length) {
    showSummary(false);
  }
  scrollToResumePoint();
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

// --- Переключатель русского перевода (работает в режиме «Обучение»;
// в «Самопроверке» перевод скрыт всегда правилами body.test-mode). ---
const RU_KEY = 'arm-test-ru';
const ruBtn = document.getElementById('ruBtn');

// Перевод меняет высоту карточек, поэтому позицию держим относительно
// вопроса, который сейчас под липкой шапкой, а не по абсолютному скроллу.
function withScrollAnchor(change) {
  const sticky = document.querySelector('.sticky-controls');
  const headerHeight = sticky ? sticky.getBoundingClientRect().height : 0;
  const cards = document.querySelectorAll('.question');
  let anchor = null;
  let anchorOffset = 0;
  for (let i = 0; i < cards.length; i++) {
    const top = cards[i].getBoundingClientRect().top - headerHeight;
    if (top + cards[i].offsetHeight > 0) {   // карточка ещё видна
      anchor = cards[i];
      anchorOffset = top;
      break;
    }
  }

  change();

  if (!anchor) return;
  const shift = (anchor.getBoundingClientRect().top - headerHeight) - anchorOffset;
  if (shift) window.scrollBy({ top: shift, behavior: 'auto' });
}

function applyRu(show) {
  withScrollAnchor(() => {
    document.body.classList.toggle('no-ru', !show);
  });
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

// --- Быстрый переход к вопросу: счётчик превращается в поле ---
// Отдельного контрола в шапке нет намеренно: тап по счётчику «6 / 135» открывает
// поле для номера на его же месте.
const jumpInput = document.getElementById('jumpInput');

// Ищем ровно тот номер, который написан в заголовке карточки: в повторении это
// номер из полного списка (там пропуски), в остальных режимах — позиция.
function findQuestionIndexByNumber(num) {
  if (currentMode === 'learn' && learnFilter === 'repeat') {
    for (let i = 0; i < questions.length; i++) {
      if (originalNumberOf(questions[i]) === num) return i;
    }
    return -1;
  }
  return (num >= 1 && num <= questions.length) ? num - 1 : -1;
}

function jumpMaxNumber() {
  return (currentMode === 'learn' && learnFilter === 'repeat')
    ? ORIGINAL_QUESTIONS.length
    : questions.length;
}

function openJumpInput() {
  if (!jumpInput || !counterEl || !questions.length) return;
  jumpInput.value = '';
  jumpInput.max = jumpMaxNumber();
  jumpInput.placeholder = '1–' + jumpMaxNumber();
  jumpInput.classList.remove('error');
  counterEl.hidden = true;
  jumpInput.hidden = false;
  jumpInput.focus();
}

function closeJumpInput() {
  if (!jumpInput || !counterEl) return;
  jumpInput.hidden = true;
  counterEl.hidden = false;
}

function submitJump() {
  const num = parseInt(jumpInput.value, 10);
  const idx = num ? findQuestionIndexByNumber(num) : -1;
  if (idx < 0) {
    jumpInput.classList.add('error');   // номера нет в текущем списке
    return;
  }
  closeJumpInput();
  scrollToQuestion(idx);
}

if (counterEl) counterEl.addEventListener('click', openJumpInput);

if (jumpInput) {
  jumpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitJump(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeJumpInput(); }
  });
  jumpInput.addEventListener('input', () => jumpInput.classList.remove('error'));
  // Тап мимо поля — просто закрываем, вернув счётчик.
  jumpInput.addEventListener('blur', () => setTimeout(closeJumpInput, 100));
}

// Возврат к тому месту, где остановились: первый неотвеченный вопрос.
function scrollToResumePoint() {
  const isStudy = currentMode === 'learn';
  const next = isStudy ? state.answers.indexOf(null) : -1;
  if (!isStudy || state.answered === 0 || next < 0) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  // С уточнением: высота карточек меняется после подгрузки шрифтов,
  // одного прыжка не хватает.
  scrollToQuestion(next, 'auto');
  requestAnimationFrame(() => scrollToQuestion(next, 'auto'));
  setTimeout(() => scrollToQuestion(next, 'auto'), 150);
}

// --- Перенос прогресса между браузерами: код-строка + файл ---
// Бэкенда нет, поэтому прогресс переносится текстом: ответы и список
// «на повторение» кодируются в одну строку по ключам вопросов (хешам текста),
// а не по индексам — код остаётся годным после пополнения банка вопросов.
const BACKUP_PREFIX = 'AT1';

const backupField = document.getElementById('backupField');
const backupStatusEl = document.getElementById('backupStatus');
const backupCopyBtn = document.getElementById('backupCopyBtn');
const backupSaveBtn = document.getElementById('backupSaveBtn');
const backupApplyBtn = document.getElementById('backupApplyBtn');
const backupFileInput = document.getElementById('backupFileInput');

function buildBackupCode() {
  const answers = Object.keys(answersStore)
    .map(function (k) { return k + ':' + answersStore[k]; })
    .join(',');
  const marks = Array.from(marksStore).join(',');
  return [BACKUP_PREFIX, TEST_ID, 'a=' + answers, 'm=' + marks].join('|');
}

function parseBackupCode(raw) {
  const text = String(raw || '').replace(/\s+/g, '');
  if (!text) return { error: 'Вставьте код в поле выше.' };
  const parts = text.split('|');
  if (parts[0] !== BACKUP_PREFIX) return { error: 'Это не код прогресса.' };
  if (parts[1] !== TEST_ID) {
    return {
      error: parts[1] === 'official'
        ? 'Это код от теста из 33 вопросов — откройте его на той странице.'
        : 'Это код от теста для подготовки — откройте его на той странице.'
    };
  }

  const answers = {};
  const marks = [];
  let unknown = 0;
  parts.slice(2).forEach(function (chunk) {
    if (chunk.indexOf('a=') === 0) {
      chunk.slice(2).split(',').forEach(function (pair) {
        if (!pair) return;
        const bits = pair.split(':');
        const key = bits[0];
        const idx = parseInt(bits[1], 10);
        if (!KNOWN_KEYS.has(key)) { unknown++; return; }
        if (!isNaN(idx)) answers[key] = idx;
      });
    } else if (chunk.indexOf('m=') === 0) {
      chunk.slice(2).split(',').forEach(function (key) {
        if (!key) return;
        if (!KNOWN_KEYS.has(key)) { unknown++; return; }
        marks.push(key);
      });
    }
  });
  return { answers: answers, marks: marks, unknown: unknown };
}

function setBackupStatus(text, kind) {
  if (!backupStatusEl) return;
  backupStatusEl.textContent = text;
  backupStatusEl.className = 'backup-status' + (kind ? ' ' + kind : '');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Safari без разрешения на буфер обмена: копируем через выделение поля.
  return new Promise(function (resolve, reject) {
    if (!backupField) return reject();
    backupField.select();
    try {
      document.execCommand('copy') ? resolve() : reject();
    } catch (e) { reject(e); }
  });
}

if (backupCopyBtn) {
  backupCopyBtn.addEventListener('click', () => {
    const code = buildBackupCode();
    if (backupField) backupField.value = code;
    copyText(code).then(
      () => setBackupStatus('Код скопирован. Вставьте его в тот же тест на другом устройстве.', 'ok'),
      () => setBackupStatus('Скопируйте код из поля вручную — браузер не дал доступ к буферу.', 'warn')
    );
  });
}

if (backupSaveBtn) {
  backupSaveBtn.addEventListener('click', () => {
    const code = buildBackupCode();
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'armenia-test-' + TEST_ID + '-' + stamp + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setBackupStatus('Файл сохранён. Его можно открыть здесь же кнопкой «Выбрать файл».', 'ok');
  });
}

function applyBackup(raw) {
  const data = parseBackupCode(raw);
  if (data.error) { setBackupStatus(data.error, 'err'); return; }

  const answersCount = Object.keys(data.answers).length;
  if (!answersCount && !data.marks.length) {
    setBackupStatus(data.unknown
      ? 'Ни один вопрос из кода не найден в этом тесте — похоже, код от другой версии банка вопросов.'
      : 'В коде нет ни ответов, ни отмеченных вопросов.', 'err');
    return;
  }
  const hasProgress = Object.keys(answersStore).length > 0 || marksStore.size > 0;
  if (hasProgress && !confirm('Заменить текущий прогресс данными из кода?\n\nТекущие ответы и список на повторение будут перезаписаны.')) {
    setBackupStatus('Отменено — прогресс не изменён.');
    return;
  }

  answersStore = data.answers;
  marksStore.clear();
  data.marks.forEach(function (k) { marksStore.add(k); });
  saveAnswers();
  saveMarks();

  modeData.learn.questions = buildLearnQuestions();
  modeData.learn.state = stateFromStore(modeData.learn.questions);
  if (currentMode === 'learn') {
    questions = modeData.learn.questions;
    state = modeData.learn.state;
    render();
  }
  syncFilterUI();

  let msg = 'Загружено: ' + answersCount + ' ' + pluralOtvety(answersCount) +
    ', на повторение — ' + data.marks.length + '.';
  if (data.unknown) msg += ' Пропущено вопросов не из этого банка: ' + data.unknown + '.';
  setBackupStatus(msg, 'ok');
}

function pluralOtvety(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'ответ';
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return 'ответа';
  return 'ответов';
}

if (backupApplyBtn) {
  backupApplyBtn.addEventListener('click', () => {
    applyBackup(backupField ? backupField.value : '');
  });
}

if (backupFileInput) {
  backupFileInput.addEventListener('change', () => {
    const file = backupFileInput.files && backupFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      if (backupField) backupField.value = String(reader.result).trim();
      applyBackup(reader.result);
    };
    reader.onerror = function () { setBackupStatus('Не удалось прочитать файл.', 'err'); };
    reader.readAsText(file);
    backupFileInput.value = '';
  });
}


// --- Список «на повторение»: метка на карточке + фильтр над списком ---
const repeatFilterBtns = document.querySelectorAll('.rf-btn');
const repeatActionsEl = document.getElementById('repeatActions');
const repeatRetryBtn = document.getElementById('repeatRetryBtn');
const repeatClearBtn = document.getElementById('repeatClearBtn');
const rfAllCountEl = document.getElementById('rfAllCount');
const rfRepeatCountEl = document.getElementById('rfRepeatCount');

// В самопроверке перевода нет вовсе, но иногда нужно понять ОДИН вопрос.
// Храним раскрытые вопросы по ключу: render() перерисовывает карточки после
// каждого ответа, иначе состояние терялось бы.
const revealedRu = new Set();

function makeRuButton(q, card) {
  const key = keyOf(q);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ru-one-btn';

  function sync(shown) {
    btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    btn.textContent = shown ? 'Скрыть перевод' : 'Перевод';
    btn.title = shown
      ? 'Скрыть русский перевод этого вопроса'
      : 'Показать русский перевод только этого вопроса';
    card.classList.toggle('show-ru', shown);
  }
  sync(revealedRu.has(key));

  btn.addEventListener('click', () => {
    const shown = !revealedRu.has(key);
    if (shown) revealedRu.add(key); else revealedRu.delete(key);
    // Высота карточки меняется — держим позицию, чтобы страница не прыгала.
    withScrollAnchor(() => sync(shown));
  });
  return btn;
}

function makeMarkButton(q) {
  const key = keyOf(q);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mark-btn';
  btn.title = 'Добавить вопрос в список на повторение';
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
    text.textContent = marked ? 'В повторении' : 'Повторить';
  }
  sync(marksStore.has(key));

  btn.addEventListener('click', () => {
    const marked = !marksStore.has(key);
    if (marked) marksStore.add(key); else marksStore.delete(key);
    saveMarks();
    sync(marked);
    updateRepeatCount();
    // Список намеренно НЕ перестраивается: карточка не должна исчезать под пальцем.
    // Снятая метка учтётся при следующем переключении фильтра.
  });
  return btn;
}

function updateRepeatCount() {
  const hasMarks = marksStore.size > 0;
  if (rfAllCountEl) rfAllCountEl.textContent = ORIGINAL_QUESTIONS.length;
  if (rfRepeatCountEl) rfRepeatCountEl.textContent = marksStore.size;
  if (repeatRetryBtn) repeatRetryBtn.disabled = !hasMarks;
  if (repeatClearBtn) repeatClearBtn.disabled = !hasMarks;
}

function syncFilterUI() {
  repeatFilterBtns.forEach(b => {
    const active = b.dataset.filter === learnFilter;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (repeatActionsEl) repeatActionsEl.hidden = learnFilter !== 'repeat';
  // Кнопки действий бессмысленны, пока список пуст.
  const hasMarks = marksStore.size > 0;
  if (repeatRetryBtn) repeatRetryBtn.disabled = !hasMarks;
  if (repeatClearBtn) repeatClearBtn.disabled = !hasMarks;
  updateRepeatCount();
}

function applyLearnFilter(filter, opts) {
  learnFilter = filter === 'repeat' ? 'repeat' : 'all';
  saveFilter();
  syncFilterUI();
  modeData.learn.questions = buildLearnQuestions();
  modeData.learn.state = stateFromStore(modeData.learn.questions);
  if (currentMode !== 'learn') return;
  questions = modeData.learn.questions;
  state = modeData.learn.state;
  render();
  if (questions.length && state.answered === questions.length) showSummary(false);
  if (!(opts && opts.keepScroll)) scrollToResumePoint();
}

repeatFilterBtns.forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.filter === learnFilter) return;
    applyLearnFilter(b.dataset.filter);
  });
});

if (repeatRetryBtn) {
  repeatRetryBtn.addEventListener('click', () => {
    const answered = Array.from(marksStore).filter(k => typeof answersStore[k] === 'number');
    if (!answered.length) return;
    if (!confirm('Пройти вопросы на повторение заново?\n\nОтветы на остальные вопросы сохранятся.')) return;
    answered.forEach(k => { delete answersStore[k]; });
    saveAnswers();
    applyLearnFilter(learnFilter);
  });
}

if (repeatClearBtn) {
  repeatClearBtn.addEventListener('click', () => {
    if (!marksStore.size) return;
    if (!confirm('Очистить список на повторение?\n\nОтветы на вопросы сохранятся.')) return;
    marksStore.clear();
    saveMarks();
    applyLearnFilter('all');
  });
}

syncFilterUI();

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

