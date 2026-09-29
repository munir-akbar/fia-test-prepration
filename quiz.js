/* ==========================================================================
   quiz.js
   Quiz engine for FIA Test Preparation.

   Responsibilities:
   - Read topic/difficulty/count from URL
   - Load and validate questions.json (new easy/hard structure)
   - Generate a non-repeating quiz using storage.js used-question tracking,
     scoped by topic + difficulty
   - Shuffle answer options independently per question (Fisher-Yates)
   - Handle navigation, answer selection, and scoring
   - Persist the completed session for result.html

   Relies on the global `QuizStorage` object defined in storage.js.

   IMPORTANT: question.id is an opaque STRING (e.g. "101-easy", "101-hard").
   It must never be parsed as a number or assumed sequential. baseId links
   the easy/hard pair together but is NOT used as the tracking key — each
   id is tracked independently, scoped by topic+difficulty.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Constants
     ------------------------------------------------------------------ */
  const QUESTIONS_JSON_PATH = 'questions.json';
  const SESSION_STORAGE_KEY = 'fiaTestPrep_currentSession';

  /* ------------------------------------------------------------------
     DOM references
     ------------------------------------------------------------------ */
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const errorMessageEl = document.getElementById('error-message');
  const quizContainer = document.getElementById('quiz-container');

  const quizTopicEl = document.getElementById('quiz-topic');
  const currentQuestionNumberEl = document.getElementById('current-question-number');
  const totalQuestionsEl = document.getElementById('total-questions');
  const progressBarWrapper = document.getElementById('progress-bar-wrapper');
  const progressBarFill = document.getElementById('progress-bar-fill');

  const questionTextEl = document.getElementById('question-text');
  const optionsListEl = document.getElementById('options-list');

  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const finishBtn = document.getElementById('finish-btn');

  const confirmDialog = document.getElementById('confirm-finish-dialog');
  const confirmCancelBtn = document.getElementById('confirm-finish-cancel');
  const confirmSubmitBtn = document.getElementById('confirm-finish-submit');

  /* ------------------------------------------------------------------
     In-memory quiz state
     ------------------------------------------------------------------ */
  let quizState = {
    topic: null,
    difficulty: null,       // "easy" | "hard"
    requestedCount: 0,
    questions: [],           // array of prepared question objects (see prepareQuestion)
    currentIndex: 0,
    answers: []               // parallel array: answers[i] = selected option string | null
  };

  /* ==========================================================================
     Utility functions
     ========================================================================== */

  /**
   * Fisher-Yates shuffle — returns a NEW shuffled array, does not mutate input.
   */
  function shuffleArray(inputArray) {
    const arr = inputArray.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Read and validate URL query parameters: topic, difficulty, count.
   * Returns { topic, difficulty, count } or throws an Error with a
   * user-facing message.
   */
  function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const topicRaw = params.get('topic');
    const difficultyRaw = params.get('difficulty');
    const countRaw = params.get('count');

    if (!topicRaw || topicRaw.trim() === '') {
      throw new Error('No topic was selected. Please go back and choose a topic.');
    }

    const topic = decodeURIComponent(topicRaw);

    const difficulty = (difficultyRaw || '').trim().toLowerCase();
    if (difficulty !== 'easy' && difficulty !== 'hard') {
      throw new Error('No valid difficulty was selected. Please go back and choose Easy or Hard.');
    }

    const count = parseInt(countRaw, 10);
    if (!countRaw || isNaN(count) || count < 1) {
      throw new Error('Invalid number of questions requested. Please go back and try again.');
    }

    return { topic, difficulty, count };
  }

  /**
   * Validate the raw questions.json data structure.
   * Returns the array if valid, throws otherwise.
   *
   * Each valid question must have:
   * - a non-empty string `id` (e.g. "101-easy") — NOT assumed numeric
   * - a string `topic`
   * - a `difficulty` of "easy" or "hard"
   * - a `question` string
   * - an `options` array with >= 2 entries
   * - a `correctAnswer` string that exactly matches one of the options
   */
  function validateQuestionsData(data) {
    if (!Array.isArray(data)) {
      throw new Error('questions.json is malformed (expected an array).');
    }

    const valid = data.filter(q =>
      q &&
      typeof q === 'object' &&
      typeof q.id === 'string' && q.id.trim() !== '' &&
      typeof q.topic === 'string' &&
      (q.difficulty === 'easy' || q.difficulty === 'hard') &&
      typeof q.question === 'string' &&
      Array.isArray(q.options) &&
      q.options.length >= 2 &&
      typeof q.correctAnswer === 'string' &&
      q.options.includes(q.correctAnswer)
    );

    if (valid.length === 0) {
      throw new Error('No valid questions were found in questions.json.');
    }

    return valid;
  }

  /**
   * Prepare a raw question object for quiz use:
   * - Shuffle its options independently.
   * - Keep the correct answer identified by VALUE (not by index),
   *   so shuffling never breaks correctness checks.
   * - Preserve id/baseId/topic/difficulty as-is (id stays a string).
   */
  function prepareQuestion(rawQuestion) {
    const shuffledOptions = shuffleArray(rawQuestion.options);
    return {
      id: rawQuestion.id,               // opaque string, e.g. "101-easy"
      baseId: rawQuestion.baseId,       // links easy/hard pair; NOT used for tracking
      topic: rawQuestion.topic,
      difficulty: rawQuestion.difficulty,
      question: rawQuestion.question,
      options: shuffledOptions,
      correctAnswer: rawQuestion.correctAnswer, // stored by value, immune to shuffling
      explanation: typeof rawQuestion.explanation === 'string' ? rawQuestion.explanation : ''
    };
  }

  /* ==========================================================================
     Quiz generation (topic+difficulty filtering + used-question rotation)
     ========================================================================== */

  /**
   * Build the list of questions for this quiz session, following the
   * unused-first / recycle-when-needed rule, scoped strictly to the
   * selected topic + difficulty. Then shuffle question order & options.
   *
   * Throws an Error with a user-facing message on any edge case failure.
   */
  function generateQuizQuestions(allQuestions, topic, difficulty, requestedCount) {
    const pool = allQuestions.filter(q => q.topic === topic && q.difficulty === difficulty);

    if (pool.length === 0) {
      throw new Error(`No ${difficulty} questions were found for the topic "${topic}".`);
    }

    if (pool.length < requestedCount) {
      throw new Error(
        `Only ${pool.length} ${difficulty} question(s) are available for "${topic}", ` +
        `but ${requestedCount} were requested.`
      );
    }

    // Get already-used question IDs for this topic+difficulty pair.
    // NOTE: this is scoped by topic+difficulty, so an Easy question being
    // used never marks its Hard counterpart (same baseId) as used.
    let usedIds = [];
    if (window.QuizStorage && typeof window.QuizStorage.getUsedQuestionIds === 'function') {
      usedIds = window.QuizStorage.getUsedQuestionIds(topic, difficulty) || [];
    }
    const usedIdSet = new Set(usedIds.map(String));

    let unusedPool = pool.filter(q => !usedIdSet.has(String(q.id)));
    let selected = [];

    if (unusedPool.length >= requestedCount) {
      // Enough unused questions — select entirely from the unused pool.
      selected = shuffleArray(unusedPool).slice(0, requestedCount);
    } else {
      // Not enough unused questions: take all unused first...
      selected = shuffleArray(unusedPool);

      const stillNeeded = requestedCount - selected.length;

      // ...then recycle the used pool for this topic+difficulty...
      if (window.QuizStorage && typeof window.QuizStorage.resetUsedQuestions === 'function') {
        window.QuizStorage.resetUsedQuestions(topic, difficulty);
      }

      // ...and pick remaining questions from the FULL topic+difficulty pool,
      // excluding any already selected in this quiz (no duplicates).
      const selectedIds = new Set(selected.map(q => String(q.id)));
      const remainingCandidates = pool.filter(q => !selectedIds.has(String(q.id)));
      const additional = shuffleArray(remainingCandidates).slice(0, stillNeeded);

      selected = selected.concat(additional);
    }

    // Final safety net: dedupe by id (string) and trim to requested count.
    const seenIds = new Set();
    selected = selected.filter(q => {
      const idStr = String(q.id);
      if (seenIds.has(idStr)) return false;
      seenIds.add(idStr);
      return true;
    }).slice(0, requestedCount);

    if (selected.length < requestedCount) {
      throw new Error(
        `Could not assemble enough unique ${difficulty} questions for "${topic}". ` +
        `Please try a smaller question count.`
      );
    }

    // Randomize overall question order, then prepare each (shuffle options).
    const orderedSelection = shuffleArray(selected);
    return orderedSelection.map(prepareQuestion);
  }

  /**
   * Mark the questions used in this quiz as "used" for the topic+difficulty,
   * so future quizzes (of the SAME difficulty) prefer unseen questions.
   * This never touches the other difficulty's used pool.
   */
  function markSessionQuestionsAsUsed(topic, difficulty, questions) {
    if (!window.QuizStorage || typeof window.QuizStorage.markQuestionsAsUsed !== 'function') {
      return;
    }
    const ids = questions.map(q => String(q.id));
    window.QuizStorage.markQuestionsAsUsed(topic, difficulty, ids);
  }

  /* ==========================================================================
     Rendering
     ========================================================================== */

  function showLoading() {
    loadingState.hidden = false;
    errorState.hidden = true;
    quizContainer.hidden = true;
  }

  function showError(message) {
    loadingState.hidden = true;
    errorState.hidden = false;
    quizContainer.hidden = true;
    errorMessageEl.textContent = message || 'Something went wrong while preparing your quiz.';
  }

  function showQuiz() {
    loadingState.hidden = true;
    errorState.hidden = true;
    quizContainer.hidden = false;
  }

  const DIFFICULTY_LABELS = { easy: 'Easy', hard: 'Hard' };

  /**
   * Render the current question, its options, progress bar, and nav buttons.
   */
  function renderCurrentQuestion() {
    const { questions, currentIndex, answers, topic, difficulty } = quizState;
    const total = questions.length;
    const question = questions[currentIndex];

    const difficultyLabel = DIFFICULTY_LABELS[difficulty] || difficulty;
    quizTopicEl.textContent = `${topic} — ${difficultyLabel}`;
    currentQuestionNumberEl.textContent = String(currentIndex + 1);
    totalQuestionsEl.textContent = String(total);

    const progressPercent = Math.round(((currentIndex + 1) / total) * 100);
    progressBarFill.style.width = `${progressPercent}%`;
    progressBarWrapper.setAttribute('aria-valuenow', String(progressPercent));

    questionTextEl.textContent = question.question;

    // Render options as accessible radio-like buttons.
    optionsListEl.innerHTML = '';
    const selectedAnswer = answers[currentIndex];

    question.options.forEach((optionText, idx) => {
      const optionBtn = document.createElement('button');
      optionBtn.type = 'button';
      optionBtn.className = 'option-item';
      optionBtn.setAttribute('role', 'radio');
      optionBtn.setAttribute('aria-checked', optionText === selectedAnswer ? 'true' : 'false');
      optionBtn.dataset.optionValue = optionText;

      if (optionText === selectedAnswer) {
        optionBtn.classList.add('is-selected');
      }

      const marker = document.createElement('span');
      marker.className = 'option-marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = String.fromCharCode(65 + idx); // A, B, C, D...

      const label = document.createElement('span');
      label.className = 'option-label';
      label.textContent = optionText;

      optionBtn.appendChild(marker);
      optionBtn.appendChild(label);

      optionBtn.addEventListener('click', () => handleOptionSelect(optionText));
      optionBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOptionSelect(optionText);
        }
      });

      optionsListEl.appendChild(optionBtn);
    });

    // Navigation button states.
    prevBtn.disabled = currentIndex === 0;

    const isLastQuestion = currentIndex === total - 1;
    nextBtn.hidden = isLastQuestion;
    finishBtn.hidden = !isLastQuestion;
  }

  /**
   * Handle a user selecting/changing an answer for the current question.
   */
  function handleOptionSelect(optionValue) {
    quizState.answers[quizState.currentIndex] = optionValue;
    renderCurrentQuestion(); // re-render to reflect selection state
  }

  /* ==========================================================================
     Navigation handlers
     ========================================================================== */

  function goToPrevious() {
    if (quizState.currentIndex > 0) {
      quizState.currentIndex -= 1;
      renderCurrentQuestion();
    }
  }

  function goToNext() {
    if (quizState.currentIndex < quizState.questions.length - 1) {
      quizState.currentIndex += 1;
      renderCurrentQuestion();
    }
  }

  function hasUnansweredQuestions() {
    return quizState.answers.some(a => a === null || a === undefined);
  }

  function requestFinish() {
    if (hasUnansweredQuestions()) {
      confirmDialog.hidden = false;
      confirmSubmitBtn.focus();
    } else {
      finishQuiz();
    }
  }

  function cancelFinish() {
    confirmDialog.hidden = true;
    finishBtn.focus();
  }

  /* ==========================================================================
     Scoring & completion
     ========================================================================== */

  /**
   * Calculate results, persist the session for result.html, mark questions
   * as used (scoped by topic+difficulty), and redirect to result.html.
   */
  function finishQuiz() {
    confirmDialog.hidden = true;

    const { questions, answers, topic, difficulty } = quizState;
    const total = questions.length;

    let correct = 0;
    let wrong = 0;
    let skipped = 0;

    const reviewQuestions = questions.map((q, idx) => {
      const userAnswer = answers[idx] ?? null;
      let status;

      if (userAnswer === null) {
        status = 'skipped';
        skipped += 1;
      } else if (userAnswer === q.correctAnswer) {
        status = 'correct';
        correct += 1;
      } else {
        status = 'wrong';
        wrong += 1;
      }

      return {
        id: q.id,
        baseId: q.baseId,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        userAnswer: userAnswer,
        status: status,
        explanation: q.explanation
      };
    });

    const attempted = correct + wrong;
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

    const sessionResult = {
      topic: topic,
      difficulty: difficulty,
      total: total,
      attempted: attempted,
      correct: correct,
      wrong: wrong,
      skipped: skipped,
      percentage: percentage,
      questions: reviewQuestions,
      date: new Date().toISOString()
    };

    // Save to sessionStorage so result.html can read it immediately.
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionResult));
    } catch (err) {
      console.error('quiz.js: failed to save session result to sessionStorage', err);
    }

    // Persist to permanent history via storage.js.
    if (window.QuizStorage && typeof window.QuizStorage.saveQuizAttempt === 'function') {
      window.QuizStorage.saveQuizAttempt(sessionResult);
    }

    // Mark these questions as used for future anti-repeat rotation,
    // scoped to this topic+difficulty pool only.
    markSessionQuestionsAsUsed(topic, difficulty, questions);

    // Redirect to results page.
    window.location.href = 'result.html';
  }

  /* ==========================================================================
     Initialization
     ========================================================================== */

  async function initQuiz() {
    showLoading();

    let params;
    try {
      params = readUrlParams();
    } catch (err) {
      showError(err.message);
      return;
    }

    let rawData;
    try {
      const response = await fetch(QUESTIONS_JSON_PATH);
      if (!response.ok) {
        throw new Error('Failed to load questions.json.');
      }
      rawData = await response.json();
    } catch (err) {
      console.error(err);
      showError('Could not load questions. Please check your connection and try again.');
      return;
    }

    let allQuestions;
    try {
      allQuestions = validateQuestionsData(rawData);
    } catch (err) {
      console.error(err);
      showError(err.message);
      return;
    }

    let preparedQuestions;
    try {
      preparedQuestions = generateQuizQuestions(allQuestions, params.topic, params.difficulty, params.count);
    } catch (err) {
      console.error(err);
      showError(err.message);
      return;
    }

    quizState = {
      topic: params.topic,
      difficulty: params.difficulty,
      requestedCount: params.count,
      questions: preparedQuestions,
      currentIndex: 0,
      answers: new Array(preparedQuestions.length).fill(null)
    };

    showQuiz();
    renderCurrentQuestion();

    // Wire up navigation buttons.
    prevBtn.addEventListener('click', goToPrevious);
    nextBtn.addEventListener('click', goToNext);
    finishBtn.addEventListener('click', requestFinish);
    confirmCancelBtn.addEventListener('click', cancelFinish);
    confirmSubmitBtn.addEventListener('click', finishQuiz);

    // Allow closing the confirm dialog with Escape.
    confirmDialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cancelFinish();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initQuiz);

})();
