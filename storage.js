/* ==========================================================================
   storage.js
   Reusable localStorage utility module for FIA Test Preparation.

   Exposes a global `QuizStorage` object with functions for:
   - Quiz attempt history
   - Topic-specific "used question" tracking

   No UI code, no question loading, no quiz-generation logic here —
   this file only manages persistence.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     Storage keys / namespace
     ------------------------------------------------------------------ */
  const STORAGE_KEYS = {
    HISTORY: 'fiaTestPrep_quizHistory',
    USED_QUESTIONS: 'fiaTestPrep_usedQuestions'
  };

  /* ------------------------------------------------------------------
     Internal helpers
     ------------------------------------------------------------------ */

  /**
   * Safely read and parse a JSON value from localStorage.
   * Returns `fallback` if the key is missing, unreadable, or corrupted.
   */
  function safeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      console.error(`QuizStorage: failed to read/parse key "${key}"`, err);
      return fallback;
    }
  }

  /**
   * Safely stringify and write a value to localStorage.
   * Returns true on success, false on failure (e.g. quota exceeded).
   */
  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`QuizStorage: failed to write key "${key}"`, err);
      return false;
    }
  }

  /**
   * Generate a reasonably unique ID for a quiz attempt
   * (timestamp + random suffix — no external libraries needed).
   */
  function generateAttemptId() {
    return `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Normalize a topic name into a safe object key.
   * Falls back to "Unknown" for missing/invalid topics.
   */
  function normalizeTopic(topic) {
    if (typeof topic !== 'string' || topic.trim() === '') {
      return 'Unknown';
    }
    return topic.trim();
  }

  /**
   * Deduplicate an array of question IDs while preserving order.
   */
  function dedupeIds(ids) {
    if (!Array.isArray(ids)) return [];
    const seen = new Set();
    const result = [];
    ids.forEach(id => {
      if (id === undefined || id === null) return;
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    });
    return result;
  }

  /* ------------------------------------------------------------------
     Quiz History
     ------------------------------------------------------------------ */

  /**
   * Get the full list of saved quiz attempts (newest last, as stored).
   * Always returns an array, even if storage is empty/corrupted.
   */
  function getQuizHistory() {
    const history = safeGet(STORAGE_KEYS.HISTORY, []);
    return Array.isArray(history) ? history : [];
  }

  /**
   * Save a completed quiz attempt to history.
   *
   * Expected `attempt` shape (fields are stored as-given; missing fields
   * are defaulted safely so the app never crashes on incomplete data):
   * {
   *   topic: string,
   *   total: number,
   *   attempted: number,
   *   correct: number,
   *   wrong: number,
   *   skipped: number,
   *   percentage: number,
   *   questions: [ ... ]   // per-question detail needed for review screen
   * }
   *
   * Returns the saved attempt object (including generated id/date),
   * or null if saving failed.
   */
  function saveQuizAttempt(attempt) {
    if (!attempt || typeof attempt !== 'object') {
      console.error('QuizStorage: saveQuizAttempt requires an attempt object');
      return null;
    }

    const total = Number(attempt.total) || 0;
    const attempted = Number(attempt.attempted) || 0;
    const correct = Number(attempt.correct) || 0;
    const wrong = Number(attempt.wrong) || 0;
    const skipped = Number(attempt.skipped) || (total - attempted >= 0 ? total - attempted : 0);
    const percentage = attempt.percentage !== undefined
      ? Number(attempt.percentage)
      : (total > 0 ? Math.round((correct / total) * 100) : 0);

    const record = {
      id: generateAttemptId(),
      date: new Date().toISOString(),
      topic: normalizeTopic(attempt.topic),
      total,
      attempted,
      correct,
      wrong,
      skipped,
      percentage,
      // Per-question review data (question text, options, user answer,
      // correct answer, explanation, etc.) — stored as-given so result.html
      // can re-render a full review without re-fetching questions.json.
      questions: Array.isArray(attempt.questions) ? attempt.questions : []
    };

    const history = getQuizHistory();
    history.push(record);

    const success = safeSet(STORAGE_KEYS.HISTORY, history);
    return success ? record : null;
  }

  /**
   * Clear all saved quiz history. Returns true on success.
   */
  function clearQuizHistory() {
    try {
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
      return true;
    } catch (err) {
      console.error('QuizStorage: failed to clear quiz history', err);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     Used Questions (topic-specific)
     ------------------------------------------------------------------ */

  /**
   * Read the entire used-questions map from storage.
   * Shape: { "Topic A": [1, 4, 8], "Topic B": [2, 5] }
   * Always returns a plain object, even if storage is empty/corrupted.
   */
  function getUsedQuestionsMap() {
    const map = safeGet(STORAGE_KEYS.USED_QUESTIONS, {});
    return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  }

  /**
   * Persist the entire used-questions map back to storage.
   */
  function saveUsedQuestionsMap(map) {
    return safeSet(STORAGE_KEYS.USED_QUESTIONS, map || {});
  }

  /**
   * Get the array of used question IDs for a specific topic.
   * Returns an empty array if the topic has no recorded usage yet.
   */
  function getUsedQuestionIds(topic) {
    const key = normalizeTopic(topic);
    const map = getUsedQuestionsMap();
    const ids = map[key];
    return Array.isArray(ids) ? ids : [];
  }

  /**
   * Add one or more question IDs to a topic's used pool.
   * Duplicate IDs are ignored automatically.
   * Returns the updated array of used IDs for that topic.
   */
  function markQuestionsAsUsed(topic, questionIds) {
    const key = normalizeTopic(topic);
    const idsToAdd = Array.isArray(questionIds) ? questionIds : [questionIds];

    const map = getUsedQuestionsMap();
    const existing = Array.isArray(map[key]) ? map[key] : [];

    const merged = dedupeIds([...existing, ...idsToAdd]);
    map[key] = merged;

    saveUsedQuestionsMap(map);
    return merged;
  }

  /**
   * Reset (clear) the used-question pool for a single topic.
   * Used when recycling the pool because not enough unused questions remain.
   * Returns true on success.
   */
  function resetUsedQuestions(topic) {
    const key = normalizeTopic(topic);
    const map = getUsedQuestionsMap();

    if (Object.prototype.hasOwnProperty.call(map, key)) {
      delete map[key];
    }

    return saveUsedQuestionsMap(map);
  }

  /**
   * Clear used-question tracking for ALL topics.
   * Returns true on success.
   */
  function clearAllUsedQuestions() {
    try {
      localStorage.removeItem(STORAGE_KEYS.USED_QUESTIONS);
      return true;
    } catch (err) {
      console.error('QuizStorage: failed to clear all used questions', err);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     Public API
     ------------------------------------------------------------------ */

  const QuizStorage = {
    // Quiz history
    getQuizHistory,
    getAttempts: getQuizHistory, // alias, in case other scripts expect this name
    saveQuizAttempt,
    clearQuizHistory,

    // Used questions (topic-specific)
    getUsedQuestionIds,
    markQuestionsAsUsed,
    resetUsedQuestions,
    clearAllUsedQuestions
  };

  // Expose globally for use by index.html, quiz.js, result.js
  // (plain <script> tags, no ES modules).
  global.QuizStorage = QuizStorage;

})(window);
