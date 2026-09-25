/* ==========================================================================
   result.js
   Renders the results page from the completed quiz session created by
   quiz.js. Reads session data (sessionStorage), displays a summary and
   full answer review, and ensures the attempt is saved to permanent
   history exactly once (even across page refreshes).

   Relies on the global `QuizStorage` object defined in storage.js.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Constants
     ------------------------------------------------------------------ */
  const SESSION_STORAGE_KEY = 'fiaTestPrep_currentSession';
  const SAVED_FLAG_KEY = 'fiaTestPrep_currentSessionSaved';

  /* ------------------------------------------------------------------
     DOM references
     ------------------------------------------------------------------ */
  const errorState = document.getElementById('error-state');
  const errorMessageEl = document.getElementById('error-message');
  const resultContainer = document.getElementById('result-container');

  const resultTopicEl = document.getElementById('result-topic');
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

  /**
   * Safely read and parse the completed quiz session from sessionStorage.
   * Returns null if missing, corrupted, or structurally invalid.
   */
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

  /**
   * Basic structural validation of the session result object.
   */
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

  /**
   * Save the completed attempt to permanent history via QuizStorage,
   * but only once per session — guarded by a sessionStorage flag so a
   * page refresh doesn't duplicate the history entry.
   */
  function saveAttemptOnce(sessionResult) {
    let alreadySaved = false;
    try {
      alreadySaved = sessionStorage.getItem(SAVED_FLAG_KEY) === 'true';
    } catch (err) {
      console.error('result.js: failed to read saved-flag from sessionStorage', err);
    }

    if (alreadySaved) return;

    if (window.QuizStorage && typeof window.QuizStorage.saveQuizAttempt === 'function') {
      window.QuizStorage.saveQuizAttempt(sessionResult);
    }

    try {
      sessionStorage.setItem(SAVED_FLAG_KEY, 'true');
    } catch (err) {
      console.error('result.js: failed to set saved-flag in sessionStorage', err);
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

  /**
   * Build a human-readable status label + CSS class for a question result.
   */
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
   * Preserves the option order exactly as shuffled/stored by quiz.js.
   */
  function renderReviewItem(questionResult, index) {
    const { question, options, correctAnswer, userAnswer, status, explanation } = questionResult;
    const statusMeta = getStatusMeta(status);

    const item = document.createElement('article');
    item.className = 'review-item';
    item.setAttribute('aria-labelledby', `review-q-${index}`);

    // Header: question number + status badge
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

    // Question text
    const questionTextEl = document.createElement('h3');
    questionTextEl.id = `review-q-${index}`;
    questionTextEl.className = 'review-question-text';
    questionTextEl.textContent = question;

    // Options list (in the same shuffled order as displayed during the quiz)
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

      // Tag showing what this option represents
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

    // Skipped note (explicit, since there's no user selection to show above)
    if (status === 'skipped') {
      const skippedNote = document.createElement('p');
      skippedNote.className = 'text-muted';
      skippedNote.textContent = 'You did not answer this question.';
      item.appendChild(skippedNote);
    }

    // Explanation, if provided
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
   * topic pre-selectable. Since topic selection lives on index.html, we
   * pass the topic as a query param the homepage can optionally honor;
   * at minimum this returns the user to start a new quiz.
   */
  function handleRetake(sessionResult) {
    const topic = encodeURIComponent(sessionResult.topic || '');
    window.location.href = `index.html?topic=${topic}`;
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

    // Persist to permanent history (guarded against duplicate saves on refresh).
    saveAttemptOnce(sessionResult);

    // Render summary + review using data already present in the session
    // (no need to reload questions.json).
    renderSummary(sessionResult);
    renderReviewList(sessionResult);

    showResults();

    retakeBtn.addEventListener('click', () => handleRetake(sessionResult));
  }

  document.addEventListener('DOMContentLoaded', initResultsPage);

})();
