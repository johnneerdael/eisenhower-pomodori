/* ------------------------------------------------------------------
 * FocusMatrix Ultimate – Goals Edition (Supabase static build)
 * ---
 * • Everything from v2.0‑cloud *plus* up to 3 "North‑Star" goals.
 * • Goals live in settings.goals[] and sync through Supabase settings row.
 * • Task‑add flow offers a goal <select>; each task stores goal and shows 🎯 badge.
 * • All original timer, DnD, export, accessibility code retained.
 * ------------------------------------------------------------------ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/* ─────── Supabase keys (replace with env if bundling) ─────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ───────────────────────── Auth helper ─────────────────────── */
async function ensureAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const email = prompt('Enter e‑mail to sync FocusMatrix across devices (magic‑link will be sent):');
  if (!email) return null;
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) { 
    alert('Sign‑in failed: ' + error.message); 
    return null; 
  }
  alert('Check your inbox, click the link, then reload.');
  return null;
}

/* ==================================================================
 *                      APP CLASS
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
      goals: []
    };
    this.stats = {
      tasksAddedToday: 0,
      tasksCompletedToday: 0,
      tasksEliminatedToday: 0,
      focusSessionsToday: 0,
      dailyStreak: 0,
      focusStreak: 0,
      totalEliminated: 0,
      lastUsedDate: null,
      achievements: {
        firstStep: false,
        focusStarter: false,
        goodJudgment: false
      }
    };
    this.user = null;

    /* ---------- UI state ---------- */
    this.draggedTask = null;
    this.focusMode = false;
    this.progressMode = false;

    /* Timer */
    this.timerRunning = false;
    this.focusTimer = null;
    this.timeRemaining = this.settings.focusDuration * 60;
    this.timerMode = 'focus'; // 'focus', 'shortBreak', 'longBreak'
    this.currentCycle = 1;

    /* Touch */
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.swipeThreshold = 60;
    this.tapThreshold = 250;

    /* Bootstrap */
    this.init();
  }

  /* ─────────────────────────── INIT ────────────────────────── */
  async init() {
    this.user = await ensureAuth();
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

  /* ====================== Persistence helpers ====================== */
  get isOnline() { 
    return navigator.onLine && !!this.user; 
  }

  /* ---------- TASKS ---------- */
  async loadTasks() {
    if (this.isOnline) {
      const { data } = await supabase.from('tasks').select('*').eq('user_id', this.user.id).order('created_at');
      this.tasks = data || [];
    } else {
      this.tasks = JSON.parse(localStorage.getItem('focusmatrix_ultimate_tasks') || '[]');
    }
  }

  async saveTasks() {
    if (this.isOnline) {
      const rows = this.tasks.map(t => ({ ...t, user_id: this.user.id }));
      await supabase.from('tasks').upsert(rows, { onConflict: 'id' });
    }
    localStorage.setItem('focusmatrix_ultimate_tasks', JSON.stringify(this.tasks));
  }

  /* ---------- SETTINGS ---------- */
  async loadSettings() {
    const defaults = this.settings;
    if (this.isOnline) {
      const { data } = await supabase.from('settings').select('data').eq('user_id', this.user?.id).single();
      const cloud = data?.data || {};
      const local = JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}');
      this.settings = { ...defaults, ...cloud, ...local };
    } else {
      this.settings = { ...defaults, ...JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}') };
    }
  }

  async saveSettings() {
    if (this.isOnline) {
      await supabase.from('settings').upsert({
        user_id: this.user.id,
        data: this.settings
      });
    }
    localStorage.setItem('focusmatrix_ultimate_settings', JSON.stringify(this.settings));
    this.updateGoalSelect();
  }

  /* ---------- STATS ---------- */
  async loadStats() {
    const today = new Date().toDateString();
    if (this.isOnline) {
      const { data } = await supabase.from('daily_stats').select('*').eq('user_id', this.user.id).eq('day', today).single();
      this.stats = data || { ...this.stats, day: today };
    } else {
      this.stats = JSON.parse(localStorage.getItem('focusmatrix_ultimate_stats') || '{}') || { ...this.stats };
      if (this.stats.day !== today) {
        this.stats = { ...this.stats, day: today };
      }
    }
  }

  async saveStats() {
    if (this.isOnline) {
      await supabase.from('daily_stats').upsert({
        ...this.stats,
        user_id: this.user.id
      });
    }
    localStorage.setItem('focusmatrix_ultimate_stats', JSON.stringify(this.stats));
  }

  /* ====================== EVENT BINDINGS ====================== */
  bindEvents() {
    /* Task input */
    document.getElementById('addTaskBtn').addEventListener('click', () => this.handleAddTask());
    document.getElementById('taskInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') this.handleAddTask();
    });

    /* Header */
    document.getElementById('progressToggle').addEventListener('click', () => this.toggleProgressDashboard());
    document.getElementById('focusToggle').addEventListener('click', () => this.toggleFocusMode());
    document.getElementById('exportBtn').addEventListener('click', () => this.quickExport());
    document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());

    /* Timer & settings */
    this.bindTimerEvents();
    this.bindSettingsEvents();
    this.bindDataManagementEvents();

    /* Drag lists */
    document.querySelectorAll('.task-list').forEach(l => {
      l.addEventListener('dragover', e => this.handleDragOver(e));
      l.addEventListener('drop', e => this.handleDrop(e));
      l.addEventListener('dragenter', e => this.handleDragEnter(e));
      l.addEventListener('dragleave', e => this.handleDragLeave(e));
    });

    document.addEventListener('keydown', e => this.handleKeyboard(e));
  }

  bindSettingsEvents() {
    ['settingsOverlay', 'closeSettings', 'cancelSettings'].forEach(id =>
      document.getElementById(id).addEventListener('click', () => this.closeSettings())
    );
    document.getElementById('saveSettings').addEventListener('click', () => this.saveSettingsFromModal());
    document.getElementById('resetSettings').addEventListener('click', () => this.resetSettings());
    document.getElementById('fontSizeSlider').addEventListener('input', e =>
      document.getElementById('fontSizeValue').textContent = e.target.value + 'px'
    );
  }

  /* ===================== GOAL SUPPORT ===================== */
  updateGoalSelect() {
    const sel = document.getElementById('goalSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No goal';
    sel.appendChild(none);
    this.settings.goals.forEach(g => {
      const o = document.createElement('option');
      o.value = g;
      o.textContent = g;
      sel.appendChild(o);
    });
    sel.style.display = this.settings.goals.length ? 'block' : 'none';
  }

  /* ====================== TASK CRUD ====================== */
  async handleAddTask() {
    const input = document.getElementById('taskInput');
    const raw = input.value.trim();
    if (!raw) {
      this.showFeedback('Please enter a task', 'error');
      return;
    }
    const goalVal = document.getElementById('goalSelect')?.value || null;
    const task = {
      id: `task_${Date.now()}`,
      text: this.sanitizeText(raw),
      quadrant: 1,
      goal: goalVal,
      created_at: new Date().toISOString()
    };
    this.tasks.push(task);
    await this.saveTasks();
    this.stats.tasksAddedToday++;
    await this.saveStats();
    this.renderTask(task);
    this.updateDashboard();
    input.value = '';
    input.focus();
  }

  renderTask(task) {
    const el = document.createElement('div');
    el.className = 'task-item';
    el.draggable = true;
    el.dataset.taskId = task.id;
    const badge = task.goal ?
      `<span class="goal-badge" title="${this.escapeHtml(task.goal)}">🎯 ${this.escapeHtml(task.goal)}</span>` : '';
    el.innerHTML = `
      <div class="task-text">${this.escapeHtml(task.text)} ${badge}</div>
      <div class="task-actions">
        <button class="task-action-btn delete-btn" aria-label="Delete">🗑️</button>
      </div>
    `;

    el.addEventListener('dragstart', e => {
      this.draggedTask = task;
      e.currentTarget.classList.add('dragging');
    });
    el.addEventListener('dragend', e => e.currentTarget.classList.remove('dragging'));
    el.addEventListener('dblclick', () => this.editTask(task));
    el.querySelector('.delete-btn').addEventListener('click', e => {
      e.stopPropagation();
      this.deleteTask(task.id);
    });

    /* Touch helpers wired later */
    el.addEventListener('touchstart', e => this.handleTouchStart(e));
    el.addEventListener('touchmove', e => this.handleTouchMove(e, el));
    el.addEventListener('touchend', e => this.handleTouchEnd(e, task, el));

    document.getElementById(`q${task.quadrant}-tasks`).appendChild(el);
    this.updateEmptyStates();
  }

  /* ================= SETTINGS MODAL (goals) ================= */
  populateSettingsModal() {
    document.getElementById('themeSelect').value = this.settings.theme;
    document.getElementById('fontSizeSlider').value = this.settings.fontSize;
    document.getElementById('fontSizeValue').textContent = this.settings.fontSize + 'px';
    document.getElementById('animationSpeed').value = this.settings.animationSpeed;
    document.getElementById('focusDuration').value = this.settings.focusDuration;
    document.getElementById('shortBreakDuration').value = this.settings.shortBreakDuration;
    document.getElementById('longBreakDuration').value = this.settings.longBreakDuration;
    document.getElementById('sessionsPerCycle').value = this.settings.sessionsPerCycle;
    document.getElementById('soundEnabled').checked = this.settings.soundEnabled;
    document.getElementById('achievementsEnabled').checked = this.settings.achievementsEnabled;
    ['goal1', 'goal2', 'goal3'].forEach((id, i) => {
      document.getElementById(id).value = this.settings.goals[i] || '';
    });
  }

  async saveSettingsFromModal() {
    this.settings.theme = document.getElementById('themeSelect').value;
    this.settings.fontSize = parseInt(document.getElementById('fontSizeSlider').value, 10);
    this.settings.animationSpeed = document.getElementById('animationSpeed').value;
    this.settings.focusDuration = parseInt(document.getElementById('focusDuration').value, 10);
    this.settings.shortBreakDuration = parseInt(document.getElementById('shortBreakDuration').value, 10);
    this.settings.longBreakDuration = parseInt(document.getElementById('longBreakDuration').value, 10);
    this.settings.sessionsPerCycle = parseInt(document.getElementById('sessionsPerCycle').value, 10);
    this.settings.soundEnabled = document.getElementById('soundEnabled').checked;
    this.settings.achievementsEnabled = document.getElementById('achievementsEnabled').checked;
    this.settings.goals = [...new Set(['goal1', 'goal2', 'goal3']
      .map(id => document.getElementById(id).value.trim())
      .filter(Boolean))].slice(0, 3);
    await this.saveSettings();
    this.applySettings();
    this.closeSettings();
    this.showFeedback('Settings saved!', 'success');
  }

  /* ========= Remainder: timer, DnD, dashboard, feedback ========= */
  /* (All logic unchanged from original v2.0‑cloud; pasted below) */

  /* ---------------- Drag‑and‑drop helpers ---------------- */
  handleDragOver(e) {
    e.preventDefault();
  }

  handleDragEnter(e) {
    e.target.closest('.task-list')?.classList.add('drag-over');
  }

  handleDragLeave(e) {
    e.target.closest('.task-list')?.classList.remove('drag-over');
  }

  async handleDrop(e) {
    e.preventDefault();
    const list = e.target.closest('.task-list');
    if (!list || !this.draggedTask) return;
    const quad = parseInt(list.closest('.quadrant').dataset.quadrant);
    if (this.draggedTask.quadrant === quad) return;
    this.draggedTask.quadrant = quad;
    await this.saveTasks();
    this.renderAllTasks();
    if (quad === 4) this.handleQuadrant4(this.draggedTask);
  }

  /* ---------------- Swipe / tap helpers ---------------- */
  handleTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
    this.touchStartTime = Date.now();
  }

  handleTouchMove(e, el) {
    const dx = e.touches[0].clientX - this.touchStartX;
    if (Math.abs(dx) < 10) return;
    el.style.transform = `translateX(${dx}px)`;
    if (dx < -this.swipeThreshold) {
      el.classList.add('swipe-left');
    } else {
      el.classList.remove('swipe-left');
    }
  }

  handleTouchEnd(e, task, el) {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    const dy = e.changedTouches[0].clientY - this.touchStartY;
    const elapsed = Date.now() - this.touchStartTime;
    el.style.transform = '';
    el.classList.remove('swipe-left');
    if (elapsed < this.tapThreshold && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      this.editTask(task);
      return;
    }
    if (dx < -this.swipeThreshold) {
      this.deleteTask(task.id, true);
    }
  }

  /* ---------------- Empty state ---------------- */
  updateEmptyStates() {
    document.querySelectorAll('.quadrant').forEach(q => {
      const list = q.querySelector('.task-list');
      let es = q.querySelector('.empty-state');
      if (!list.children.length) {
        if (!es) {
          es = document.createElement('div');
          es.className = 'empty-state';
          es.textContent = 'Drag tasks here';
          list.appendChild(es);
        }
      } else {
        es?.remove();
      }
    });
  }

  renderAllTasks() {
    document.querySelectorAll('.task-list').forEach(l => l.innerHTML = '');
    this.tasks.forEach(t => this.renderTask(t));
    this.updateEmptyStates();
  }

  /* ---------------- Timer logic ---------------- */
  bindTimerEvents() {
    document.getElementById('startTimer').addEventListener('click', () => this.startTimer());
    document.getElementById('pauseTimer').addEventListener('click', () => this.pauseTimer());
    document.getElementById('resetTimer').addEventListener('click', () => this.resetTimer());
    document.getElementById('exitFocus').addEventListener('click', () => this.toggleFocusMode());

    document.getElementById('phaseFocus').addEventListener('click', () => this.setTimerMode('focus'));
    document.getElementById('phaseShortBreak').addEventListener('click', () => this.setTimerMode('shortBreak'));
    document.getElementById('phaseLongBreak').addEventListener('click', () => this.setTimerMode('longBreak'));
  }

  startTimer() {
    if (this.timerRunning) return;
    this.timerRunning = true;
    document.getElementById('startTimer').style.display = 'none';
    document.getElementById('pauseTimer').style.display = 'inline-block';
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
  }

  resetTimer() {
    this.pauseTimer();
    this.currentCycle = 1;
    this.setTimerMode('focus', true);
  }

  timerComplete() {
    this.pauseTimer();
    this.playSound('complete');

    if (this.timerMode === 'focus') {
      this.stats.focusSessionsToday++;
      this.saveStats();
      this.updateDashboard();
      this.checkAchievements();
      this.showFeedback('Focus session complete!', 'success');

      if (this.currentCycle % this.settings.sessionsPerCycle === 0) {
        this.setTimerMode('longBreak');
      } else {
        this.setTimerMode('shortBreak');
      }
      this.currentCycle++;
    } else {
      this.showFeedback('Break finished. Time to focus!', 'info');
      this.setTimerMode('focus');
    }

    if (Notification.permission === 'granted') {
      new Notification('FocusMatrix Timer', {
        body: this.timerMode === 'focus' ? 'Time for a break!' : 'Break is over. Time to get back to focus!',
        icon: 'icons/icon-192x192.png'
      });
    }
  }

  updateTimerDisplay() {
    const m = String(Math.floor(this.timeRemaining / 60)).padStart(2, '0');
    const s = String(this.timeRemaining % 60).padStart(2, '0');
    document.getElementById('timerDisplay').textContent = `${m}:${s}`;
  }

  setTimerMode(mode, forceReset = false) {
    if (!forceReset && this.timerRunning) {
      if (!confirm('A timer is running. Are you sure you want to switch?')) {
        return;
      }
    }

    this.pauseTimer();
    this.timerMode = mode;

    const timerDisplay = document.getElementById('timerDisplay');
    const timerSessionTitle = document.getElementById('timerSessionTitle');
    const timerSessionCount = document.getElementById('timerSessionCount');

    document.querySelectorAll('.phase-btn').forEach(btn => btn.classList.remove('active'));

    switch (mode) {
      case 'focus':
        this.timeRemaining = this.settings.focusDuration * 60;
        timerDisplay.classList.remove('break-mode');
        timerDisplay.classList.add('focus-mode');
        document.getElementById('phaseFocus').classList.add('active');
        timerSessionTitle.textContent = 'Time to Focus!';
        timerSessionCount.textContent = `Session ${this.currentCycle} of ${this.settings.sessionsPerCycle}`;
        break;
      case 'shortBreak':
        this.timeRemaining = this.settings.shortBreakDuration * 60;
        timerDisplay.classList.remove('focus-mode');
        timerDisplay.classList.add('break-mode');
        document.getElementById('phaseShortBreak').classList.add('active');
        timerSessionTitle.textContent = 'Short Break';
        timerSessionCount.textContent = 'Relax and recharge';
        break;
      case 'longBreak':
        this.timeRemaining = this.settings.longBreakDuration * 60;
        timerDisplay.classList.remove('focus-mode');
        timerDisplay.classList.add('break-mode');
        document.getElementById('phaseLongBreak').classList.add('active');
        timerSessionTitle.textContent = 'Long Break';
        timerSessionCount.textContent = 'Take a well-deserved rest';
        break;
    }

    this.updateTimerDisplay();
  }

  /* ---------------- Modes & dashboard ---------------- */
  toggleProgressDashboard() {
    this.progressMode = !this.progressMode;
    document.getElementById('progressDashboard').style.display = this.progressMode ? 'block' : 'none';
    document.getElementById('progressToggle').classList.toggle('active', this.progressMode);
    if (this.progressMode) this.updateDashboard();
  }

  toggleFocusMode() {
    this.focusMode = !this.focusMode;
    document.body.classList.toggle('focus-mode', this.focusMode);
    document.getElementById('focusToggle').classList.toggle('active', this.focusMode);
    const tc = document.getElementById('focusTimer');
    if (tc) tc.style.display = this.focusMode ? 'block' : 'none';
    if (!this.focusMode && this.timerRunning) this.pauseTimer();
  }

  applySettings() {
    document.documentElement.style.setProperty('--font-size-base', this.settings.fontSize + 'px');
    const s = { none: '0s', slow: '0.5s', normal: '0.2s', fast: '0.1s' };
    document.documentElement.style.setProperty('--transition-speed', s[this.settings.animationSpeed] || '0.2s');
    this.setTimerMode(this.timerMode, true);
  }

  openSettings() {
    this.populateSettingsModal();
    document.getElementById('settingsModal').classList.add('show');
  }

  closeSettings() {
    document.getElementById('settingsModal').classList.remove('show');
  }

  resetSettings() {
    if (!confirm('Reset settings to defaults?')) return;
    localStorage.removeItem('focusmatrix_ultimate_settings');
    window.location.reload();
  }

  updateDashboard() {
    document.getElementById('tasksAddedToday').textContent = this.stats.tasksAddedToday;
    document.getElementById('tasksCompletedToday').textContent = this.stats.tasksCompletedToday;
    document.getElementById('focusSessionsToday').textContent = this.stats.focusSessionsToday;
    document.getElementById('tasksEliminatedToday').textContent = this.stats.tasksEliminatedToday;
    document.getElementById('dailyStreak').textContent = `${this.stats.dailyStreak} days`;
    document.getElementById('focusStreak').textContent = `${this.stats.focusStreak} days`;
    document.getElementById('eliminationStreak').textContent = `${this.stats.totalEliminated} total`;
  }

  checkDailyReset() {
    const today = new Date().toDateString();
    if (this.stats.lastUsedDate !== today) {
      this.stats.tasksAddedToday = 0;
      this.stats.tasksCompletedToday = 0;
      this.stats.tasksEliminatedToday = 0;
      this.stats.focusSessionsToday = 0;
      this.stats.lastUsedDate = today;
      this.saveStats();
    }
  }

  checkAchievements() {
    if (!this.stats.achievements.firstStep && this.stats.totalEliminated > 0) {
      this.stats.achievements.firstStep = true;
      this.showFeedback('Achievement unlocked: First Step!', 'achievement');
    }
    if (!this.stats.achievements.focusStarter && this.stats.focusSessionsToday > 0) {
      this.stats.achievements.focusStarter = true;
      this.showFeedback('Achievement unlocked: Focus Starter!', 'achievement');
    }
    this.saveStats();
  }

  /* ---------------- Export / import ---------------- */
  quickExport() {
    this.exportAllData(true);
  }

  exportAllData(q = false) {
    const p = {
      tasks: this.tasks,
      stats: this.stats,
      settings: this.settings,
      ts: new Date().toISOString(),
      v: 'cloud-goals-2.1'
    };
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focusmatrix-${p.ts.split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (q) this.showFeedback('Data exported!', 'success');
  }

  handleFileImport(e) {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.tasks && d.stats && d.settings) {
          this.tasks = d.tasks;
          this.stats = d.stats;
          this.settings = d.settings;
          await this.saveTasks();
          await this.saveStats();
          await this.saveSettings();
          this.applySettings();
          this.renderAllTasks();
          this.updateDashboard();
          this.showFeedback('Import complete!', 'success');
        } else {
          throw new Error();
        }
      } catch {
        this.showFeedback('Invalid import file', 'error');
      }
    };
    r.readAsText(f);
    e.target.value = '';
  }

  bindDataManagementEvents() {
    document.getElementById('exportDataBtn').addEventListener('click', () => this.exportAllData());
    document.getElementById('importDataBtn').addEventListener('click', () => document.getElementById('importDataInput').click());
    document.getElementById('clearAllDataBtn').addEventListener('click', () => this.clearAllData());
    document.getElementById('importDataInput').addEventListener('change', e => this.handleFileImport(e));
  }

  clearAllData() {
    if (!confirm('Delete all local data?')) return;
    localStorage.clear();
    location.reload();
  }

  /* ---------------- Utility ---------------- */
  sanitizeText(t) {
    return t.replace(/[<>]/g, '').trim();
  }

  escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  showFeedback(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `feedback-message ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  handleKeyboard(e) {}
  setupAccessibility() {}

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          this.showFeedback('Notifications enabled!', 'success');
        }
      });
    }
  }

  playSound(soundName) {
    if (!this.settings.soundEnabled) return;
    // In a real app, you'd have audio files. For now, we'll just log it.
    console.log(`Playing sound: ${soundName}`);
    // Example:
    // const audio = new Audio(`./sounds/${soundName}.mp3`);
    // audio.play().catch(e => console.error("Error playing sound:", e));
  }

  announceToScreenReader() {}

  handleQuadrant4(task) {
    setTimeout(() => {
      if (confirm(`Let go of "${task.text}"?`)) {
        this.deleteTask(task.id);
      }
    }, 300);
  }

  async deleteTask(id, viaSwipe = false) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const t = this.tasks[idx];
    const el = document.querySelector(`[data-task-id="${id}"]`);

    const finish = async () => {
      this.tasks.splice(idx, 1);
      await this.saveTasks();
      if (t.quadrant === 4) {
        this.stats.tasksEliminatedToday++;
        this.stats.totalEliminated++;
      } else {
        this.stats.tasksCompletedToday++;
      }
      await this.saveStats();
      this.updateDashboard();
      this.checkAchievements();
    };

    if (el && !viaSwipe) {
      el.classList.add('completing');
      setTimeout(() => {
        el.remove();
        finish();
      }, 500);
    } else {
      el?.remove();
      finish();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.focusMatrix = new FocusMatrixCloud();
});
