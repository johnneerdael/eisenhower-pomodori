/* ------------------------------------------------------------------
 * FocusMatrix Ultimate – Goals & Audio Edition (Supabase static build)
 * ---
 * • Adds Tone.js for dynamic, file-free audio generation.
 * • New AudioManager class handles all sound logic.
 * • Settings for soundscapes (rain, noise) and ticking clock.
 * ------------------------------------------------------------------ */

import { createClient } from '@supabase/supabase-js';
import { App as CapApp } from '@capacitor/app';
import * as Tone from 'tone'; // NEW: Import Tone.js as a module

/* ------------------------------------------------------------------ */

/* ── Deep-link handler ── */
CapApp.addListener('appUrlOpen', ({ url }) => {
  if (url && url.startsWith('focusmatrix://auth-callback')) {
    const webUrl = url.replace('focusmatrix://auth-callback', 'https://dummy.local/');
    window.location.replace(webUrl);
  }
});

/* ─────── Supabase keys ─────── */
const SUPABASE_URL = "https://mzxeyosjcunoucmjgvln.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eGV5b3NqY3Vub3VjbWpndmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzOTgyODIsImV4cCI6MjA2Nzk3NDI4Mn0.kXdS6Pvxt6Q62G5IOo_NZhc2jinTM7swfc7MfBxsJvE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ───────────────────────── Audio Manager (NEW & ROBUST) ─────────────────────── */
class AudioManager {
  constructor(app) {
      this.app = app;
      this.isInitialized = false;
      this.sounds = {};
      this.activeSound = null; // Single property for any active sound
  }

  async init() {
      if (this.isInitialized) return true;
      try {
          await Tone.start();
          console.log('🔊 Audio context started.');

          this.sounds.complete = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 1 } }).toDestination();
          this.sounds.tick = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).toDestination();
          this.sounds.tick.volume.value = -18;
          
          this.sounds.white = new Tone.Noise('white').toDestination();
          this.sounds.pink = new Tone.Noise('pink').toDestination();
          this.sounds.brown = new Tone.Noise('brown').toDestination();
          
          [this.sounds.white, this.sounds.pink, this.sounds.brown].forEach(n => n.volume.value = -20);

          this.isInitialized = true;
          return true;
      } catch (e) {
          console.error("Failed to initialize Tone.js:", e);
          return false;
      }
  }

  playSound(soundName) {
      if (!this.isInitialized || !this.app.settings.soundEnabled || !this.sounds[soundName]) return;
      if (soundName === 'complete') {
          this.sounds.complete.triggerAttackRelease('C5', '8n', Tone.now());
      }
  }

  // Unified function to start whatever sound is selected in settings
  updateSoundscape() {
      this.stopSoundscape(); // Stop anything currently playing
      if (!this.isInitialized || !this.app.settings.soundEnabled) return;

      const type = this.app.settings.soundscape;
      if (type === 'none') return;

      if (type === 'ticking') {
          this.activeSound = new Tone.Loop(time => {
              this.sounds.tick.triggerAttackRelease('C4', '32n', time);
          }, '1s').start(0);
      } else if (this.sounds[type]) {
          this.activeSound = this.sounds[type];
      }
      
      if (this.activeSound) {
          this.activeSound.start();
          Tone.Transport.start();
      }
  }

  // Unified function to stop all background sounds
  stopSoundscape() {
      if (this.activeSound) {
          this.activeSound.stop();
          // Important: Dispose loops, but not the shared noise instances
          if (this.activeSound instanceof Tone.Loop) {
              this.activeSound.dispose();
          }
          this.activeSound = null;
          Tone.Transport.stop();
      }
  }
}


/* ───────────────────────── Auth UI Manager ─────────────────────── */
class AuthManager {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('authContainer');
    this.form = document.getElementById('authForm');
    this.emailInput = document.getElementById('authEmail');
    this.passwordInput = document.getElementById('authPassword');
    this.loginBtn = document.getElementById('loginBtn');
    this.signupBtn = document.getElementById('signupBtn');
    this.resetLink = document.getElementById('resetPasswordLink');
    this.feedback = document.getElementById('authFeedback');
    this.authPromise = new Promise(resolve => { this.resolveAuth = resolve; });
  }
  show() { this.container.style.display = 'flex'; }
  hide() { this.container.style.display = 'none'; }
  bindEvents() {
    this.form.addEventListener('submit', async (e) => {
      e.preventDefault(); this.setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email: this.emailInput.value, password: this.passwordInput.value });
      if (error) { this.showFeedback(error.message, 'error'); } 
      else if (data.user) { this.showFeedback('Success! Loading your matrix...', 'success'); this.app.user = data.user; this.resolveAuth(data.user); setTimeout(() => this.hide(), 1000); }
      this.setLoading(false);
    });
    this.signupBtn.addEventListener('click', async () => {
      this.setLoading(true);
      const { data, error } = await supabase.auth.signUp({ email: this.emailInput.value, password: this.passwordInput.value });
      if (error) { this.showFeedback(error.message, 'error'); } 
      else { this.showFeedback('Success! Check your email for a confirmation link.', 'success'); }
      this.setLoading(false);
    });
    this.resetLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = this.emailInput.value;
        if (!email) { this.showFeedback('Please enter your email address first.', 'error'); return; }
        this.setLoading(true);
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://pomodoro.thepi.es' });
        if (error) { this.showFeedback(error.message, 'error'); } 
        else { this.showFeedback('Password reset link sent! Check your email.', 'success'); }
        this.setLoading(false);
    });
  }
  showFeedback(message, type = 'info') { this.feedback.textContent = message; this.feedback.className = `auth-feedback ${type}`; this.feedback.style.display = 'block'; }
  setLoading(isLoading) { this.loginBtn.disabled = isLoading; this.signupBtn.disabled = isLoading; this.loginBtn.textContent = isLoading ? '...' : 'Log In'; }
}

/* ==================================================================
 * APP CLASS
 * ================================================================== */
export class FocusMatrixCloud {
  constructor() {
    /* ---------- Core data ---------- */
    this.tasks = [];
    this.settings = {
      theme: 'auto',
      fontSize: 16,
      animationSpeed: 'normal',
      soundEnabled: false,
      achievementsEnabled: true,
      focusDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 30,
      sessionsPerCycle: 4,
      goals: [],
      soundscape: 'none',
      tickingEnabled: false,
    };
    this.stats = { tasksAddedToday: 0, tasksCompletedToday: 0, tasksEliminatedToday: 0, focusSessionsToday: 0, dailyStreak: 0, focusStreak: 0, totalEliminated: 0, lastUsedDate: null, achievements: { firstStep: false, focusStarter: false, goodJudgment: false } };
    this.user = null;

    /* ---------- UI state ---------- */
    this.draggedTask = null;
    this.focusMode = false;
    this.progressMode = false;
    this.authManager = new AuthManager(this);
    this.audioManager = new AudioManager(this);
    this.focusedTask = null;

    this.handleLogout = async () => {
      const { error } = await supabase.auth.signOut();
      if (error) { console.error('Error logging out:', error); this.showFeedback('Error logging out. Please try again.', 'error'); } 
      else { window.location.reload(); }
    };

    /* Timer */
    this.timerRunning = false;
    this.focusTimer = null;
    this.timeRemaining = this.settings.focusDuration * 60;
    this.timerMode = 'focus';
    this.currentCycle = 1;

    /* Touch */
    this.touchStartX = 0; this.touchStartY = 0; this.touchStartTime = 0; this.swipeThreshold = 60; this.tapThreshold = 250;

    /* Bootstrap */
    this.init();
  }

  /* ─────────────────────────── INIT ────────────────────────── */
  async init() {
    this.authManager.bindEvents();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) { this.user = session.user; } 
    else { this.authManager.show(); this.user = await this.authManager.authPromise; }
    document.getElementById('logoutBtn').style.display = 'inline-flex';
    await this.loadSettings();
    await this.loadStats();
    await this.loadTasks();
    this.applySettings();
    this.bindEvents();
    this.renderAllTasks();
    this.updateGoalSelect();
    this.updateDashboard();
    this.checkDailyReset();
    this.requestNotificationPermission();
  }

  /* ====================== EVENT BINDINGS ====================== */
  bindEvents() {
    document.getElementById('addTaskBtn').addEventListener('click', () => this.handleAddTask());
    document.getElementById('taskInput').addEventListener('keypress', e => { if (e.key === 'Enter') this.handleAddTask(); });
    document.getElementById('progressToggle').addEventListener('click', () => this.toggleProgressDashboard());
    document.getElementById('focusToggle').addEventListener('click', () => this.toggleFocusMode());
    document.getElementById('exportBtn').addEventListener('click', () => this.quickExport());
    document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
    document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
    document.querySelectorAll('.focus-quadrant-btn').forEach(btn => { btn.addEventListener('click', () => { this.startFocusOnQuadrant(parseInt(btn.dataset.quadrant, 10)); }); });
    this.bindTimerEvents();
    this.bindSettingsEvents();
    this.bindDataManagementEvents();
    document.querySelectorAll('.task-list').forEach(l => { l.addEventListener('dragover', e => this.handleDragOver(e)); l.addEventListener('drop', e => this.handleDrop(e)); l.addEventListener('dragenter', e => this.handleDragEnter(e)); l.addEventListener('dragleave', e => this.handleDragLeave(e)); });
    document.addEventListener('keydown', e => this.handleKeyboard(e));
  }

  /* ====================== TASK RENDERING ====================== */
  renderTask(task) {
    const el = document.createElement('div');
    el.className = 'task-item';
    el.draggable = true;
    el.dataset.taskId = task.id;
    const badge = task.goal ? `<span class="goal-badge" title="${this.escapeHtml(task.goal)}">🎯 ${this.escapeHtml(task.goal)}</span>` : '';
    el.innerHTML = `<div class="task-text">${this.escapeHtml(task.text)} ${badge}</div><div class="task-actions"><button class="task-action-btn focus-task-btn" aria-label="Focus on this task">🎯</button><button class="task-action-btn delete-btn" aria-label="Delete">🗑️</button></div>`;
    el.addEventListener('dragstart', e => { this.draggedTask = task; e.currentTarget.classList.add('dragging'); });
    el.addEventListener('dragend', e => e.currentTarget.classList.remove('dragging'));
    el.addEventListener('dblclick', () => this.editTask(task));
    el.querySelector('.focus-task-btn').addEventListener('click', (e) => { e.stopPropagation(); this.startFocusOnTask(task); });
    el.querySelector('.delete-btn').addEventListener('click', e => { e.stopPropagation(); this.deleteTask(task.id); });
    el.addEventListener('touchstart', e => this.handleTouchStart(e));
    el.addEventListener('touchmove', e => this.handleTouchMove(e, el));
    el.addEventListener('touchend', e => this.handleTouchEnd(e, task, el));
    document.getElementById(`q${task.quadrant}-tasks`).appendChild(el);
    this.updateEmptyStates();
  }

  /* ====================== FOCUS LOOP FEATURES ====================== */
  startFocusOnQuadrant(quadrantNumber) {
    const taskToFocus = this.tasks.find(t => t.quadrant === quadrantNumber);
    if (taskToFocus) { this.startFocusOnTask(taskToFocus); } 
    else { this.showFeedback(`Quadrant ${quadrantNumber} has no tasks to focus on.`, 'info'); }
  }

  startFocusOnTask(task) {
    this.focusedTask = task;
    document.getElementById('timerTaskText').textContent = task.text;
    const matrixContainer = document.getElementById('matrixContainer');
    matrixContainer.classList.add('focus-active');
    document.querySelectorAll('.quadrant').forEach(q => q.classList.remove('is-focus-target'));
    document.querySelector(`.quadrant[data-quadrant="${task.quadrant}"]`).classList.add('is-focus-target');
    this.setTimerMode('focus', true);
    this.toggleFocusMode();
    this.startTimer();
  }

  endFocusSession() {
    this.focusedTask = null;
    document.getElementById('timerTaskText').textContent = 'Ready for the next challenge!';
    document.getElementById('matrixContainer').classList.remove('focus-active');
    document.querySelectorAll('.quadrant').forEach(q => q.classList.remove('is-focus-target'));
    this.audioManager.stopSoundscape();
    this.audioManager.stopTicking();
  }

  showTriageModal() {
    const modal = document.getElementById('triageModal');
    if (!this.focusedTask) return;
    document.getElementById('triageTaskText').textContent = this.focusedTask.text;
    modal.style.display = 'flex';
    const completeBtn = document.getElementById('triageCompleteBtn');
    const incompleteBtn = document.getElementById('triageIncompleteBtn');
    const handleComplete = async () => { if (this.focusedTask) { await this.deleteTask(this.focusedTask.id); } cleanupAndProceed(); };
    const handleIncomplete = () => { cleanupAndProceed(); };
    const cleanupAndProceed = () => {
        completeBtn.removeEventListener('click', handleComplete);
        incompleteBtn.removeEventListener('click', handleIncomplete);
        modal.style.display = 'none';
        this.endFocusSession();
        this.stats.focusSessionsToday++;
        this.saveStats();
        this.updateDashboard();
        this.checkAchievements();
        this.showFeedback('Focus session complete!', 'success');
        if (this.currentCycle % this.settings.sessionsPerCycle === 0) { this.setTimerMode('longBreak'); } 
        else { this.setTimerMode('shortBreak'); }
        this.currentCycle++;
        this.startTimer();
    };
    completeBtn.addEventListener('click', handleComplete, { once: true });
    incompleteBtn.addEventListener('click', handleIncomplete, { once: true });
  }

  /* ====================== TIMER LOGIC (MODIFIED) ====================== */
  async startTimer() {
    if (this.timerRunning) return;
    const audioReady = await this.audioManager.init();
    this.timerRunning = true;
    document.getElementById('startTimer').style.display = 'none';
    document.getElementById('pauseTimer').style.display = 'inline-block';
    if (audioReady && this.timerMode === 'focus') {
        this.audioManager.startTicking();
    }
    this.focusTimer = setInterval(() => {
      if (!this.timerRunning) return;
      this.timeRemaining = Math.max(0, this.timeRemaining - 1);
      this.updateTimerDisplay();
      if (this.timeRemaining === 0) this.timerComplete();
    }, 1000);
  }

  pauseTimer() {
    if (!this.timerRunning) return;
    clearInterval(this.focusTimer);
    this.timerRunning = false;
    document.getElementById('startTimer').style.display = 'inline-block';
    document.getElementById('pauseTimer').style.display = 'none';
    this.audioManager.stopTicking();
  }
  
  timerComplete() {
    this.pauseTimer();
    this.playSound('complete');
    if (this.timerMode === 'focus' && this.focusedTask) { this.showTriageModal(); } 
    else { 
      if (this.timerMode === 'focus') {
          this.stats.focusSessionsToday++; this.saveStats(); this.updateDashboard(); this.checkAchievements();
          this.showFeedback('Focus session complete!', 'success');
      } else { this.showFeedback('Break finished. Time to focus!', 'info'); }
      if (this.currentCycle % this.settings.sessionsPerCycle === 0 && this.timerMode === 'focus') { this.setTimerMode('longBreak'); } 
      else if (this.timerMode === 'focus') { this.setTimerMode('shortBreak'); } 
      else { this.setTimerMode('focus'); }
      this.currentCycle = (this.timerMode === 'focus') ? this.currentCycle : this.currentCycle + 1;
      this.startTimer();
    }
    if (Notification.permission === 'granted') { new Notification('FocusMatrix Timer', { body: this.timerMode === 'focus' ? 'Time for a break!' : 'Break is over!', icon: 'icons/icon-192x192.png' }); }
  }

  /* ====================== MODES & DASHBOARD (MODIFIED) ====================== */
  toggleFocusMode() {
    this.focusMode = !this.focusMode;
    document.body.classList.toggle('focus-mode', this.focusMode);
    if (this.focusMode) { this.audioManager.startSoundscape(); } 
    else {
      if (this.timerRunning) { this.pauseTimer(); }
      this.endFocusSession();
    }
  }

  /* ====================== SETTINGS (MODIFIED) ====================== */
  applySettings() {
    document.documentElement.style.setProperty('--font-size-base', this.settings.fontSize + 'px');
    const s = { none: '0s', slow: '0.5s', normal: '0.2s', fast: '0.1s' };
    document.documentElement.style.setProperty('--transition-speed', s[this.settings.animationSpeed] || '0.2s');
    this.setTimerMode(this.timerMode, true);
    if (this.focusMode) { this.audioManager.startSoundscape(); }
    else { this.audioManager.stopSoundscape(); }
  }

  populateSettingsModal() {
    document.getElementById('themeSelect').value = this.settings.theme;
    document.getElementById('fontSizeSlider').value = this.settings.fontSize;
    document.getElementById('fontSizeValue').textContent = this.settings.fontSize + 'px';
    document.getElementById('animationSpeed').value = this.settings.animationSpeed;
    document.getElementById('focusDuration').value = this.settings.focusDuration;
    document.getElementById('shortBreakDuration').value = this.settings.shortBreakDuration;
    document.getElementById('longBreakDuration').value = this.settings.longBreakDuration;
    document.getElementById('sessionsPerCycle').value = this.settings.sessionsPerCycle;
    document.getElementById('achievementsEnabled').checked = this.settings.achievementsEnabled;
    document.getElementById('soundEnabled').checked = this.settings.soundEnabled;
    document.getElementById('soundscapeSelect').value = this.settings.soundscape;
    document.getElementById('tickingClockEnabled').checked = this.settings.tickingEnabled;
    ['goal1', 'goal2', 'goal3'].forEach((id, i) => { document.getElementById(id).value = this.settings.goals[i] || ''; });
  }

  async saveSettingsFromModal() {
    this.settings.theme = document.getElementById('themeSelect').value;
    this.settings.fontSize = parseInt(document.getElementById('fontSizeSlider').value, 10);
    this.settings.animationSpeed = document.getElementById('animationSpeed').value;
    this.settings.focusDuration = parseInt(document.getElementById('focusDuration').value, 10);
    this.settings.shortBreakDuration = parseInt(document.getElementById('shortBreakDuration').value, 10);
    this.settings.longBreakDuration = parseInt(document.getElementById('longBreakDuration').value, 10);
    this.settings.sessionsPerCycle = parseInt(document.getElementById('sessionsPerCycle').value, 10);
    this.settings.achievementsEnabled = document.getElementById('achievementsEnabled').checked;
    this.settings.soundEnabled = document.getElementById('soundEnabled').checked;
    this.settings.soundscape = document.getElementById('soundscapeSelect').value;
    this.settings.tickingEnabled = document.getElementById('tickingClockEnabled').checked;
    this.settings.goals = [...new Set(['goal1', 'goal2', 'goal3'].map(id => document.getElementById(id).value.trim()).filter(Boolean))].slice(0, 3);
    await this.saveSettings();
    this.applySettings();
    this.closeSettings();
    this.showFeedback('Settings saved!', 'success');
  }

  /* ====================== UTILITY (MODIFIED) ====================== */
  playSound(soundName) {
      this.audioManager.playSound(soundName);
  }

  /* ====================== UNCHANGED METHODS ====================== */
  get isOnline() { return navigator.onLine && !!this.user; }
  async loadTasks() { if (this.isOnline) { const { data, error } = await supabase.from('tasks').select('*').eq('user_id', this.user.id).order('created_at'); if (error) { this.tasks = JSON.parse(localStorage.getItem('focusmatrix_ultimate_tasks') || '[]'); return; } this.tasks = (data || []).map(dbTask => ({ id: `task_${dbTask.id}`, database_id: dbTask.id, text: dbTask.text, quadrant: dbTask.quadrant, goal: dbTask.goal || null, created_at: dbTask.created_at })); } else { this.tasks = JSON.parse(localStorage.getItem('focusmatrix_ultimate_tasks') || '[]'); } }
  async saveTasks() { if (this.isOnline) { const newTasks = this.tasks.filter(t => !t.database_id); const existingTasks = this.tasks.filter(t => t.database_id); if (newTasks.length > 0) { const insertData = newTasks.map(t => ({ user_id: this.user.id, text: t.text, quadrant: t.quadrant, goal: t.goal, created_at: t.created_at, updated_at: new Date().toISOString() })); const { data: insertedTasks, error: insertError } = await supabase.from('tasks').insert(insertData).select(); if (!insertError && insertedTasks) { insertedTasks.forEach((dbTask, index) => { const localTask = newTasks[index]; if (localTask) localTask.database_id = dbTask.id; }); } } if (existingTasks.length > 0) { const updates = existingTasks.map(t => ({ id: t.database_id, user_id: this.user.id, text: t.text, quadrant: t.quadrant, goal: t.goal, updated_at: new Date().toISOString() })); await supabase.from('tasks').upsert(updates); } } localStorage.setItem('focusmatrix_ultimate_tasks', JSON.stringify(this.tasks)); }
  async loadSettings() { const defaults = this.settings; if (this.isOnline) { try { const { data, error } = await supabase.from('settings').select('data').eq('user_id', this.user?.id).single(); if (error && error.code !== 'PGRST116') console.error('Error loading settings:', error); const cloud = data?.data || {}; const local = JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}'); this.settings = { ...defaults, ...cloud, ...local }; } catch (error) { this.settings = { ...defaults, ...JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}') }; } } else { this.settings = { ...defaults, ...JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}') }; } }
  async saveSettings() { if (this.isOnline) { await supabase.from('settings').upsert({ user_id: this.user.id, data: this.settings }); } localStorage.setItem('focusmatrix_ultimate_settings', JSON.stringify(this.settings)); this.updateGoalSelect(); }
  async loadStats() { const today = new Date().toISOString().split('T')[0]; if (this.isOnline) { const { data, error } = await supabase.from('daily_stats').select('*').eq('user_id', this.user.id).eq('day', today).single(); if (error && error.code !== 'PGRST116') console.error('Error loading stats:', error); if (data) { this.stats = { ...this.stats, ...data, tasksAddedToday: data.tasks_added || 0, tasksCompletedToday: data.tasks_completed || 0, tasksEliminatedToday: data.tasks_eliminated || 0, focusSessionsToday: data.focus_sessions || 0, lastUsedDate: today, day: today }; } else { this.stats.tasksAddedToday = 0; this.stats.tasksCompletedToday = 0; this.stats.tasksEliminatedToday = 0; this.stats.focusSessionsToday = 0; this.stats.lastUsedDate = today; this.stats.day = today; } } else { this.stats = JSON.parse(localStorage.getItem('focusmatrix_ultimate_stats') || '{}') || { ...this.stats }; if (this.stats.day !== today) this.stats = { ...this.stats, day: today }; } }
  async saveStats() { if (this.isOnline) { const today = new Date().toISOString().split('T')[0]; await supabase.from('daily_stats').upsert({ user_id: this.user.id, day: today, tasks_added: this.stats.tasksAddedToday || 0, tasks_completed: this.stats.tasksCompletedToday || 0, tasks_eliminated: this.stats.tasksEliminatedToday || 0, focus_sessions: this.stats.focusSessionsToday || 0 }, { onConflict: 'user_id,day' }); } localStorage.setItem('focusmatrix_ultimate_stats', JSON.stringify(this.stats)); }
  bindSettingsEvents() { ['settingsOverlay', 'closeSettings', 'cancelSettings'].forEach(id => document.getElementById(id).addEventListener('click', () => this.closeSettings())); document.getElementById('saveSettings').addEventListener('click', () => this.saveSettingsFromModal()); document.getElementById('resetSettings').addEventListener('click', () => this.resetSettings()); document.getElementById('fontSizeSlider').addEventListener('input', e => document.getElementById('fontSizeValue').textContent = e.target.value + 'px'); }
  updateGoalSelect() { const sel = document.getElementById('goalSelect'); if (!sel) return; sel.innerHTML = ''; const none = document.createElement('option'); none.value = ''; none.textContent = 'No goal'; sel.appendChild(none); this.settings.goals.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); }); sel.style.display = this.settings.goals.length ? 'block' : 'none'; }
  async handleAddTask() { const input = document.getElementById('taskInput'); const raw = input.value.trim(); if (!raw) { this.showFeedback('Please enter a task', 'error'); return; } const goalVal = document.getElementById('goalSelect')?.value || null; const task = { id: `task_${Date.now()}`, text: this.sanitizeText(raw), quadrant: 1, goal: goalVal, created_at: new Date().toISOString() }; this.tasks.push(task); await this.saveTasks(); this.stats.tasksAddedToday++; await this.saveStats(); this.renderTask(task); this.updateDashboard(); input.value = ''; input.focus(); }
  handleDragOver(e) { e.preventDefault(); }
  handleDragEnter(e) { e.target.closest('.task-list')?.classList.add('drag-over'); }
  handleDragLeave(e) { e.target.closest('.task-list')?.classList.remove('drag-over'); }
  async handleDrop(e) { e.preventDefault(); const list = e.target.closest('.task-list'); if (!list || !this.draggedTask) return; const quad = parseInt(list.closest('.quadrant').dataset.quadrant); if (this.draggedTask.quadrant === quad) return; this.draggedTask.quadrant = quad; await this.saveTasks(); this.renderAllTasks(); if (quad === 4) this.handleQuadrant4(this.draggedTask); }
  handleTouchStart(e) { this.touchStartX = e.touches[0].clientX; this.touchStartY = e.touches[0].clientY; this.touchStartTime = Date.now(); }
  handleTouchMove(e, el) { const dx = e.touches[0].clientX - this.touchStartX; if (Math.abs(dx) < 10) return; el.style.transform = `translateX(${dx}px)`; if (dx < -this.swipeThreshold) el.classList.add('swipe-left'); else el.classList.remove('swipe-left'); }
  handleTouchEnd(e, task, el) { const dx = e.changedTouches[0].clientX - this.touchStartX; const dy = e.changedTouches[0].clientY - this.touchStartY; const elapsed = Date.now() - this.touchStartTime; el.style.transform = ''; el.classList.remove('swipe-left'); if (elapsed < this.tapThreshold && Math.abs(dx) < 10 && Math.abs(dy) < 10) { this.editTask(task); return; } if (dx < -this.swipeThreshold) this.deleteTask(task.id, true); }
  updateEmptyStates() { document.querySelectorAll('.quadrant').forEach(q => { const list = q.querySelector('.task-list'); let es = q.querySelector('.empty-state'); if (!list.children.length) { if (!es) { es = document.createElement('div'); es.className = 'empty-state'; es.textContent = 'Drag tasks here'; list.appendChild(es); } } else { es?.remove(); } }); }
  renderAllTasks() { document.querySelectorAll('.task-list').forEach(l => l.innerHTML = ''); this.tasks.forEach(t => this.renderTask(t)); this.updateEmptyStates(); }
  bindTimerEvents() { document.getElementById('startTimer').addEventListener('click', () => this.startTimer()); document.getElementById('pauseTimer').addEventListener('click', () => this.pauseTimer()); document.getElementById('resetTimer').addEventListener('click', () => this.resetTimer()); document.getElementById('exitFocus').addEventListener('click', () => this.toggleFocusMode()); document.getElementById('phaseFocus').addEventListener('click', () => this.setTimerMode('focus')); document.getElementById('phaseShortBreak').addEventListener('click', () => this.setTimerMode('shortBreak')); document.getElementById('phaseLongBreak').addEventListener('click', () => this.setTimerMode('longBreak')); }
  resetTimer() { this.pauseTimer(); this.currentCycle = 1; this.setTimerMode('focus', true); }
  updateTimerDisplay() { const m = String(Math.floor(this.timeRemaining / 60)).padStart(2, '0'); const s = String(this.timeRemaining % 60).padStart(2, '0'); document.getElementById('timerDisplay').textContent = `${m}:${s}`; }
  setTimerMode(mode, forceReset = false) { if (!forceReset && this.timerRunning) { if (!confirm('A timer is running. Are you sure you want to switch?')) return; } this.pauseTimer(); this.timerMode = mode; const timerDisplay = document.getElementById('timerDisplay'); const timerSessionTitle = document.getElementById('timerSessionTitle'); const timerSessionCount = document.getElementById('timerSessionCount'); document.querySelectorAll('.phase-btn').forEach(btn => btn.classList.remove('active')); switch (mode) { case 'focus': this.timeRemaining = this.settings.focusDuration * 60; timerDisplay.classList.remove('break-mode'); timerDisplay.classList.add('focus-mode'); document.getElementById('phaseFocus').classList.add('active'); timerSessionTitle.textContent = 'Time to Focus!'; timerSessionCount.textContent = `Session ${this.currentCycle} of ${this.settings.sessionsPerCycle}`; break; case 'shortBreak': this.timeRemaining = this.settings.shortBreakDuration * 60; timerDisplay.classList.remove('focus-mode'); timerDisplay.classList.add('break-mode'); document.getElementById('phaseShortBreak').classList.add('active'); timerSessionTitle.textContent = 'Short Break'; timerSessionCount.textContent = 'Relax and recharge'; break; case 'longBreak': this.timeRemaining = this.settings.longBreakDuration * 60; timerDisplay.classList.remove('focus-mode'); timerDisplay.classList.add('break-mode'); document.getElementById('phaseLongBreak').classList.add('active'); timerSessionTitle.textContent = 'Long Break'; timerSessionCount.textContent = 'Take a well-deserved rest'; break; } this.updateTimerDisplay(); }
  toggleProgressDashboard() { this.progressMode = !this.progressMode; document.getElementById('progressDashboard').style.display = this.progressMode ? 'block' : 'none'; document.getElementById('progressToggle').classList.toggle('active', this.progressMode); if (this.progressMode) this.updateDashboard(); }
  openSettings() { this.populateSettingsModal(); document.getElementById('settingsModal').classList.add('show'); }
  closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }
  resetSettings() { if (!confirm('Reset settings to defaults?')) return; localStorage.removeItem('focusmatrix_ultimate_settings'); window.location.reload(); }
  updateDashboard() { document.getElementById('tasksAddedToday').textContent = this.stats.tasksAddedToday; document.getElementById('tasksCompletedToday').textContent = this.stats.tasksCompletedToday; document.getElementById('focusSessionsToday').textContent = this.stats.focusSessionsToday; document.getElementById('tasksEliminatedToday').textContent = this.stats.tasksEliminatedToday; document.getElementById('dailyStreak').textContent = `${this.stats.dailyStreak} days`; document.getElementById('focusStreak').textContent = `${this.stats.focusStreak} days`; document.getElementById('eliminationStreak').textContent = `${this.stats.totalEliminated} total`; }
  checkDailyReset() { const today = new Date().toDateString(); if (this.stats.lastUsedDate !== today) { this.stats.tasksAddedToday = 0; this.stats.tasksCompletedToday = 0; this.stats.tasksEliminatedToday = 0; this.stats.focusSessionsToday = 0; this.stats.lastUsedDate = today; this.saveStats(); } }
  checkAchievements() { if (!this.stats.achievements.firstStep && this.stats.totalEliminated > 0) { this.stats.achievements.firstStep = true; this.showFeedback('Achievement unlocked: First Step!', 'achievement'); } if (!this.stats.achievements.focusStarter && this.stats.focusSessionsToday > 0) { this.stats.achievements.focusStarter = true; this.showFeedback('Achievement unlocked: Focus Starter!', 'achievement'); } this.saveStats(); }
  quickExport() { this.exportAllData(true); }
  exportAllData(q = false) { const p = { tasks: this.tasks, stats: this.stats, settings: this.settings, ts: new Date().toISOString(), v: 'cloud-goals-2.1' }; const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `focusmatrix-${p.ts.split('T')[0]}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); if (q) this.showFeedback('Data exported!', 'success'); }
  handleFileImport(e) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = async ev => { try { const d = JSON.parse(ev.target.result); if (d.tasks && d.stats && d.settings) { this.tasks = d.tasks; this.stats = d.stats; this.settings = d.settings; await this.saveTasks(); await this.saveStats(); await this.saveSettings(); this.applySettings(); this.renderAllTasks(); this.updateDashboard(); this.showFeedback('Import complete!', 'success'); } else { throw new Error(); } } catch { this.showFeedback('Invalid import file', 'error'); } }; r.readAsText(f); e.target.value = ''; }
  bindDataManagementEvents() { document.getElementById('exportDataBtn').addEventListener('click', () => this.exportAllData()); document.getElementById('importDataBtn').addEventListener('click', () => document.getElementById('importDataInput').click()); document.getElementById('clearAllDataBtn').addEventListener('click', () => this.clearAllData()); document.getElementById('importDataInput').addEventListener('change', e => this.handleFileImport(e)); }
  clearAllData() { if (!confirm('Delete all local data?')) return; localStorage.clear(); location.reload(); }
  sanitizeText(t) { return t.replace(/[<>]/g, '').trim(); }
  escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  showFeedback(msg, type = 'info') { const el = document.createElement('div'); el.className = `feedback-message ${type}`; el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 3000); }
  handleKeyboard(e) {}
  setupAccessibility() {}
  requestNotificationPermission() { if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') { Notification.requestPermission().then(permission => { if (permission === 'granted') { this.showFeedback('Notifications enabled!', 'success'); } }); } }
  announceToScreenReader() {}
  editTask(task) { const el = document.querySelector(`[data-task-id="${task.id}"]`); if (!el) return; const taskTextEl = el.querySelector('.task-text'); const currentText = task.text; const input = document.createElement('input'); input.type = 'text'; input.value = currentText; input.className = 'task-edit-input'; input.maxLength = 200; taskTextEl.innerHTML = ''; taskTextEl.appendChild(input); input.focus(); input.select(); const saveEdit = async () => { const newText = this.sanitizeText(input.value.trim()); if (newText && newText !== currentText) { task.text = newText; await this.saveTasks(); this.showFeedback('Task updated!', 'success'); } this.renderAllTasks(); }; const cancelEdit = () => { this.renderAllTasks(); }; input.addEventListener('blur', saveEdit); input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } }); }
  handleQuadrant4(task) { setTimeout(() => { if (confirm(`Let go of "${task.text}"?`)) { this.deleteTask(task.id); } }, 300); }
  async deleteTask(id, viaSwipe = false) { const idx = this.tasks.findIndex(t => t.id === id); if (idx === -1) return; const t = this.tasks[idx]; const el = document.querySelector(`[data-task-id="${id}"]`); const finish = async () => { if (this.isOnline && t.database_id) { await supabase.from('tasks').delete().eq('id', t.database_id); } this.tasks.splice(idx, 1); if (t.quadrant === 4) { this.stats.tasksEliminatedToday++; this.stats.totalEliminated++; } else { this.stats.tasksCompletedToday++; } localStorage.setItem('focusmatrix_ultimate_tasks', JSON.stringify(this.tasks)); await this.saveStats(); this.updateDashboard(); this.checkAchievements(); }; if (el && !viaSwipe) { el.classList.add('completing'); setTimeout(() => { el.remove(); finish(); }, 500); } else { el?.remove(); finish(); } }
}

document.addEventListener('DOMContentLoaded', () => {
  window.focusMatrix = new FocusMatrixCloud();
  const burgerBtn = document.getElementById('burger');
  const mobileNav = document.getElementById('mobileNav');

  if (burgerBtn && mobileNav) {
    burgerBtn.addEventListener('click', () => {
      const isExpanded = burgerBtn.getAttribute('aria-expanded') === 'true';
      burgerBtn.setAttribute('aria-expanded', String(!isExpanded));
      mobileNav.classList.toggle('is-open');
      mobileNav.setAttribute('aria-hidden', String(isExpanded));
    });

    mobileNav.querySelectorAll('.mobile-item').forEach(item => {
      item.addEventListener('click', () => {
        burgerBtn.setAttribute('aria-expanded', 'false');
        mobileNav.classList.remove('is-open');
        mobileNav.setAttribute('aria-hidden', 'true');
      });
    });
  }
});
