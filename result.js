/* ==========================================================================
   result.js
   Renders the results page from the completed quiz session created by
   quiz.js. Reads session data (sessionStorage), displays a summary
   (including Topic + Difficulty) and full answer review, and ensures the
   attempt is saved to permanent history exactly once (even across page
   refreshes).

   Relies on the global `QuizStorage` object defined in storage.js.

   IMPORTANT: question ids are opaque strings (e.g. "101-hard"). Review
   items are matched to the user's answer via the stored `userAnswer`/
   `correctAnswer` TEXT already present in each session question record —
   never by array position — so shuffled option order never breaks review.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Constants
     ------------------------------------------------------------------ */
  const SESSION_STORAGE_KEY = 'fiaTestPrep_currentSession';
  const SAVED_FLAG_KEY = 'fiaTestPrep_currentSessionSaved';

  const DIFFICULTY_LABELS = { easy: 'Easy', hard: 'Hard' };

  /* ------------------------------------------------------------------
     DOM references
     ------------------------------------------------------------------ */
  const errorState = document.getElementById('error-state');
  const errorMessageEl = document.getElementById('error-message');
  const resultContainer = document.getElementById('result-container');

  const resultTopicEl = document.getElementById('result-topic');
  const resultDifficultyEl = document.getElementById('result-difficulty');
  const scoreCircleEl = document.getElementById('score-circle');
  const scorePercentageEl = document.getElementById('score-percentage');

  const statTotalEl = document.getElementById('stat-total');
  const statAttemptedEl = document.getElementById('stat-attempted');
  const statCorrectEl = document.getElementById('stat-correct');
  const statWrongEl = document.getElementById('stat-wrong');
  const statSkippedEl = document.getElementById('stat-skipped');
  const statScoreEl = document.getElementById('stat-score');

  const reviewListEl = document.getElementById('review-list');
  const retakeBtn = document.getElementById('retake-btn');

  /* ==========================================================================
     Session retrieval & validation
     ========================================================================== */

  function getSessionResult() {
    let raw;
    try {
      raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch (err) {
      console.error('result.js: failed to read sessionStorage', err);
      return null;
    }

    if (!raw) return null;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error('result.js: failed to parse session result JSON', err);
      return null;
    }

    if (!isValidSession(data)) {
      console.error('result.js: session result failed validation', data);
      return null;
    }

    return data;
  }

  function isValidSession(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.topic !== 'string' || data.topic.trim() === '') return false;
    if (typeof data.total !== 'number' || data.total < 0) return false;
    if (!Array.isArray(data.questions)) return false;
    return true;
  }

  /* ==========================================================================
     Persisting the attempt (once per session)
     ========================================================================== */

  function saveAttemptOnce(sessionResult) {
    let alreadySaved = false;
    try {
      alreadySaved = sessionStorage.getItem(SAVED_FLAG_KEY) === 'true';
    } catch (err) {
      console.error('result.js: failed to read saved-flag from sessionStorage', err);
    }

    if (alreadySaved) return;

    // Set the guard flag immediately to close the race where two
    // near-simultaneous calls both read "not yet saved".
    try {
      sessionStorage.setItem(SAVED_FLAG_KEY, 'true');
    } catch (err) {
      console.error('result.js: failed to set saved-flag in sessionStorage', err);
    }

    // Extra safety net: refuse to save an attempt identical to the most
    // recent saved attempt within the last few seconds.
    if (window.QuizStorage && typeof window.QuizStorage.getQuizHistory === 'function') {
      const history = window.QuizStorage.getQuizHistory();
      const last = history[history.length - 1];
      if (last &&
          last.topic === sessionResult.topic &&
          last.difficulty === sessionResult.difficulty &&
          last.total === sessionResult.total &&
          last.correct === sessionResult.correct &&
          last.wrong === sessionResult.wrong &&
          last.skipped === sessionResult.skipped) {
        const lastTime = new Date(last.date).getTime();
        const now = Date.now();
        if (!isNaN(lastTime) && (now - lastTime) < 5000) {
          return;
        }
      }
    }

    if (window.QuizStorage && typeof window.QuizStorage.saveQuizAttempt === 'function') {
      window.QuizStorage.saveQuizAttempt(sessionResult);
    }
  }

  /* ==========================================================================
     Rendering: summary
     ========================================================================== */

  function calculatePercentage(correct, total) {
    if (!total || total <= 0) return 0;
    return Math.round((correct / total) * 100);
  }

  function renderSummary(sessionResult) {
    const total = sessionResult.total || 0;
    const attempted = sessionResult.attempted ?? 0;
    const correct = sessionResult.correct ?? 0;
    const wrong = sessionResult.wrong ?? 0;
    const skipped = sessionResult.skipped ?? Math.max(total - attempted, 0);
    const percentage = sessionResult.percentage !== undefined
      ? sessionResult.percentage
      : calculatePercentage(correct, total);

    resultTopicEl.textContent = sessionResult.topic;

    if (resultDifficultyEl) {
      const label = DIFFICULTY_LABELS[sessionResult.difficulty] || '—';
      resultDifficultyEl.textContent = label;
    }

    statTotalEl.textContent = String(total);
    statAttemptedEl.textContent = String(attempted);
    statCorrectEl.textContent = String(correct);
    statWrongEl.textContent = String(wrong);
    statSkippedEl.textContent = String(skipped);
    statScoreEl.textContent = `${percentage}%`;

    scorePercentageEl.textContent = `${percentage}%`;
    scoreCircleEl.style.setProperty('--score', percentage);
    scoreCircleEl.setAttribute('aria-label', `Score: ${percentage} percent`);
  }

  /* ==========================================================================
     Rendering: answer review
     ========================================================================== */

  function getStatusMeta(status) {
    switch (status) {
      case 'correct':
        return { label: 'Correct', className: 'status-correct' };
      case 'wrong':
        return { label: 'Wrong', className: 'status-wrong' };
      case 'skipped':
      default:
        return { label: 'Skipped', className: 'status-skipped' };
    }
  }

  /**
   * Render one reviewed question block.
   * Preserves the option order exactly as shuffled/stored by quiz.js, and
   * matches correctness by comparing TEXT values (correctAnswer/userAnswer),
   * never by array index — so shuffled options never break the review.
   */
  function renderReviewItem(questionResult, index) {
    const { question, options, correctAnswer, userAnswer, status, explanation } = questionResult;
    const statusMeta = getStatusMeta(status);

    const item = document.createElement('article');
    item.className = 'review-item';
    item.setAttribute('aria-labelledby', `review-q-${index}`);

    const header = document.createElement('div');
    header.className = 'review-item-header';

    const numberEl = document.createElement('span');
    numberEl.className = 'review-question-number';
    numberEl.textContent = `Question ${index + 1}`;

    const badgeEl = document.createElement('span');
    badgeEl.className = `review-status-badge ${statusMeta.className}`;
    badgeEl.textContent = statusMeta.label;

    header.appendChild(numberEl);
    header.appendChild(badgeEl);

    const questionTextEl = document.createElement('h3');
    questionTextEl.id = `review-q-${index}`;
    questionTextEl.className = 'review-question-text';
    questionTextEl.textContent = question;

    const optionsListEl = document.createElement('div');
    optionsListEl.className = 'review-options-list';

    (options || []).forEach(optionText => {
      const optionEl = document.createElement('div');
      optionEl.className = 'review-option';

      const isCorrectOption = optionText === correctAnswer;
      const isUserSelected = optionText === userAnswer;
      const isUserWrongSelection = isUserSelected && !isCorrectOption;

      if (isCorrectOption) {
        optionEl.classList.add('is-correct-answer');
      }
      if (isUserWrongSelection) {
        optionEl.classList.add('is-user-wrong-answer');
      }

      const textSpan = document.createElement('span');
      textSpan.textContent = optionText;
      optionEl.appendChild(textSpan);

      let tagText = '';
      if (isCorrectOption && isUserSelected) {
        tagText = 'Your answer • Correct';
      } else if (isCorrectOption) {
        tagText = 'Correct answer';
      } else if (isUserWrongSelection) {
        tagText = 'Your answer';
      }

      if (tagText) {
        const tagEl = document.createElement('span');
        tagEl.className = 'review-option-tag';
        tagEl.textContent = tagText;
        optionEl.appendChild(tagEl);
      }

      optionsListEl.appendChild(optionEl);
    });

    item.appendChild(header);
    item.appendChild(questionTextEl);
    item.appendChild(optionsListEl);

    if (status === 'skipped') {
      const skippedNote = document.createElement('p');
      skippedNote.className = 'text-muted';
      skippedNote.textContent = 'You did not answer this question.';
      item.appendChild(skippedNote);
    }

    if (explanation && explanation.trim() !== '') {
      const explanationEl = document.createElement('p');
      explanationEl.className = 'review-explanation';
      explanationEl.innerHTML = `<strong>Explanation:</strong> `;
      explanationEl.appendChild(document.createTextNode(explanation));
      item.appendChild(explanationEl);
    }

    return item;
  }

  function renderReviewList(sessionResult) {
    reviewListEl.innerHTML = '';

    const questions = Array.isArray(sessionResult.questions) ? sessionResult.questions : [];

    if (questions.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'status-message';
      emptyMsg.textContent = 'No question details are available for this attempt.';
      reviewListEl.appendChild(emptyMsg);
      return;
    }

    questions.forEach((q, idx) => {
      reviewListEl.appendChild(renderReviewItem(q, idx));
    });
  }

  /* ==========================================================================
     Error state
     ========================================================================== */

  function showError() {
    errorState.hidden = false;
    resultContainer.hidden = true;
    if (errorMessageEl) {
      errorMessageEl.textContent = "We couldn't find your quiz results. Please try taking the quiz again.";
    }
  }

  function showResults() {
    errorState.hidden = true;
    resultContainer.hidden = false;
  }

  /* ==========================================================================
     Navigation actions
     ========================================================================== */

  /**
   * "Retake This Quiz" — send the user back to the homepage with the same
   * topic and difficulty pre-fillable. Since selection lives on
   * index.html, we pass them as query params the homepage can optionally
   * read; at minimum this returns the user to start a new quiz.
   */
  function handleRetake(sessionResult) {
    const topic = encodeURIComponent(sessionResult.topic || '');
    const difficulty = encodeURIComponent(sessionResult.difficulty || '');
    window.location.href = `index.html?topic=${topic}&difficulty=${difficulty}`;
  }

  /* ==========================================================================
     Initialization
     ========================================================================== */

  function initResultsPage() {
    const sessionResult = getSessionResult();

    if (!sessionResult) {
      showError();
      return;
    }

    saveAttemptOnce(sessionResult);

    renderSummary(sessionResult);
    renderReviewList(sessionResult);

    showResults();

    retakeBtn.addEventListener('click', () => handleRetake(sessionResult));
  }

  document.addEventListener('DOMContentLoaded', initResultsPage);

})();
