/* ------------------------------------------------------------------
 * FocusMatrix Ultimate – Goals Edition (Supabase static build)
 * ---
 * • Everything from v2.0‑cloud *plus* up to 3 "North‑Star" goals.
 * • Goals live in settings.goals[] and sync through Supabase settings row.
 * • Task‑add flow offers a goal <select>; each task stores goal and shows 🎯 badge.
 * • All original timer, DnD, export, accessibility code retained.
 * ------------------------------------------------------------------ */

import { createClient } from '@supabase/supabase-js';
import { App as CapApp } from '@capacitor/app';            // NEW – Capacitor deep-link helper
/* ------------------------------------------------------------------ */

/* ── Deep-link handler: fires when a magic-link opens the IPA ── */
CapApp.addListener('appUrlOpen', ({ url }) => {
  if (url && url.startsWith('focusmatrix://auth-callback')) {
    /* Relay the URL into the WebView so Supabase JS can read #access_token */
    const webUrl = url.replace('focusmatrix://auth-callback', 'https://dummy.local/');
    window.location.replace(webUrl);
  }
});

/* ─────── Supabase keys (replace with env if bundling) ─────── */
const SUPABASE_URL = "https://mzxeyosjcunoucmjgvln.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eGV5b3NqY3Vub3VjbWpndmxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzOTgyODIsImV4cCI6MjA2Nzk3NDI4Mn0.kXdS6Pvxt6Q62G5IOo_NZhc2jinTM7swfc7MfBxsJvE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ───────────────────────── Auth helper ─────────────────────── */
async function ensureAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const email = prompt('Enter e‑mail to sync FocusMatrix across devices (magic‑link will be sent):');
  if (!email) return null;
  const isNative = window.location.protocol === 'capacitor:' || window.location.protocol === 'app:';
  const redirectUrl = isNative ? 'focusmatrix://auth-callback'
                               : 'https://pomodoro.thepi.es';
  
  await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectUrl }
  });
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
      console.log('🔄 Loading tasks from Supabase for user:', this.user.id);
      const { data, error } = await supabase.from('tasks').select('*').eq('user_id', this.user.id).order('created_at');
      
      if (error) {
        console.error('❌ Error loading tasks from Supabase:', error);
        console.log('📁 Falling back to localStorage');
        this.tasks = JSON.parse(localStorage.getItem('focusmatrix_ultimate_tasks') || '[]');
        return;
      }
      
      console.log('✅ Successfully loaded', data?.length || 0, 'tasks from Supabase');
      
      // Map database tasks to our local format
      this.tasks = (data || []).map(dbTask => ({
        id: `task_${dbTask.id}`, // Keep our local ID format for UI consistency
        database_id: dbTask.id,   // Store the actual database ID
        text: dbTask.text,
        quadrant: dbTask.quadrant,
        goal: dbTask.goal || null,
        created_at: dbTask.created_at
      }));
      
      console.log('🔄 Mapped to local format:', this.tasks.length, 'tasks');
    } else {
      console.log('📱 Loading tasks from localStorage (offline mode)');
      this.tasks = JSON.parse(localStorage.getItem('focusmatrix_ultimate_tasks') || '[]');
      console.log('📁 Loaded', this.tasks.length, 'tasks from localStorage');
    }
  }

  async saveTasks() {
    console.log('💾 Saving tasks - Total tasks:', this.tasks.length);
    console.log('🌐 Online status:', this.isOnline, '| User ID:', this.user?.id);
    
    if (this.isOnline) {
      try {
        // For new tasks (those without database IDs), we need to insert them
        const newTasks = this.tasks.filter(t => !t.database_id);
        const existingTasks = this.tasks.filter(t => t.database_id);
        
        console.log('📊 Task breakdown: New:', newTasks.length, '| Existing:', existingTasks.length);
        
        // Insert new tasks
        if (newTasks.length > 0) {
          console.log('➕ Inserting', newTasks.length, 'new tasks...');
          const insertData = newTasks.map(t => ({
            user_id: this.user.id,
            text: t.text,
            quadrant: t.quadrant,
            goal: t.goal,
            created_at: t.created_at,
            updated_at: new Date().toISOString()
          }));
          
          console.log('📝 Insert data:', JSON.stringify(insertData, null, 2));
          
          const { data: insertedTasks, error: insertError } = await supabase
            .from('tasks')
            .insert(insertData)
            .select();
          
          if (insertError) {
            console.error('❌ Error inserting tasks:', insertError);
            console.error('🔍 Insert error details:', JSON.stringify(insertError, null, 2));
          } else if (insertedTasks) {
            console.log('✅ Successfully inserted', insertedTasks.length, 'tasks');
            console.log('🆔 Inserted task IDs:', insertedTasks.map(t => t.id));
            
            // Update local tasks with database IDs
            insertedTasks.forEach((dbTask, index) => {
              const localTask = newTasks[index];
              if (localTask) {
                console.log('🔗 Mapping local task', localTask.id, 'to database ID', dbTask.id);
                localTask.database_id = dbTask.id;
              }
            });
          }
        }
        
        // Update existing tasks
        if (existingTasks.length > 0) {
          console.log('📝 Updating', existingTasks.length, 'existing tasks...');
          const updates = existingTasks.map(t => ({
            id: t.database_id,
            user_id: this.user.id,
            text: t.text,
            quadrant: t.quadrant,
            goal: t.goal,
            updated_at: new Date().toISOString()
          }));
          
          console.log('📝 Update data:', JSON.stringify(updates, null, 2));
          
          const { error: updateError } = await supabase
            .from('tasks')
            .upsert(updates);
          
          if (updateError) {
            console.error('❌ Error updating tasks:', updateError);
            console.error('🔍 Update error details:', JSON.stringify(updateError, null, 2));
          } else {
            console.log('✅ Successfully updated', existingTasks.length, 'tasks');
          }
        }
        
        console.log('💾 Supabase save operation completed');
        
      } catch (error) {
        console.error('💥 Exception saving tasks to Supabase:', error);
        console.error('🔍 Exception stack:', error.stack);
      }
    } else {
      console.log('📱 Offline mode - skipping Supabase save');
    }
    
    // Always save to localStorage
    console.log('💿 Saving to localStorage...');
    localStorage.setItem('focusmatrix_ultimate_tasks', JSON.stringify(this.tasks));
    console.log('✅ LocalStorage save completed');
  }

  /* ---------- SETTINGS ---------- */
  async loadSettings() {
    const defaults = this.settings;
    if (this.isOnline) {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('data')
          .eq('user_id', this.user?.id)
          .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
          console.error('Error loading settings:', error);
        }
        
        const cloud = data?.data || {};
        const local = JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}');
        this.settings = { ...defaults, ...cloud, ...local };
      } catch (error) {
        console.error('Error loading settings:', error);
        // Fall back to local storage
        this.settings = { ...defaults, ...JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}') };
      }
    } else {
      this.settings = { ...defaults, ...JSON.parse(localStorage.getItem('focusmatrix_ultimate_settings') || '{}') };
    }
  }

  async saveSettings() {
    if (this.isOnline) {
      try {
        const { error } = await supabase
          .from('settings')
          .upsert({
            user_id: this.user.id,
            data: this.settings
          });
        
        if (error) {
          console.error('Error saving settings:', error);
        }
      } catch (error) {
        console.error('Error saving settings:', error);
      }
    }
    localStorage.setItem('focusmatrix_ultimate_settings', JSON.stringify(this.settings));
    this.updateGoalSelect();
  }

  /* ---------- STATS ---------- */
  async loadStats() {
    const today = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD for DATE type
    if (this.isOnline) {
      try {
        const { data, error } = await supabase
          .from('daily_stats')
          .select('*')
          .eq('user_id', this.user.id)
          .eq('day', today)
          .single();
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
          console.error('Error loading stats:', error);
        }
        
        if (data) {
          // Map database fields to local stats structure
          this.stats = {
            tasksAddedToday: data.tasks_added || 0,
            tasksCompletedToday: data.tasks_completed || 0,
            tasksEliminatedToday: data.tasks_eliminated || 0,
            focusSessionsToday: data.focus_sessions || 0,
            dailyStreak: this.stats.dailyStreak || 0, // Keep existing local values
            focusStreak: this.stats.focusStreak || 0,
            totalEliminated: this.stats.totalEliminated || 0,
            lastUsedDate: today,
            achievements: this.stats.achievements || {
              firstStep: false,
              focusStarter: false,
              goodJudgment: false
            },
            day: today
          };
        } else {
          // No data for today, reset daily counters
          this.stats.tasksAddedToday = 0;
          this.stats.tasksCompletedToday = 0;
          this.stats.tasksEliminatedToday = 0;
          this.stats.focusSessionsToday = 0;
          this.stats.lastUsedDate = today;
          this.stats.day = today;
        }
      } catch (error) {
        console.error('Error loading stats:', error);
        // Fall back to local storage
        this.stats = JSON.parse(localStorage.getItem('focusmatrix_ultimate_stats') || '{}') || { ...this.stats };
      }
    } else {
      this.stats = JSON.parse(localStorage.getItem('focusmatrix_ultimate_stats') || '{}') || { ...this.stats };
      if (this.stats.day !== today) {
        this.stats = { ...this.stats, day: today };
      }
    }
  }

  async saveStats() {
    if (this.isOnline) {
      try {
        const today = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
        const { error } = await supabase
          .from('daily_stats')
          .upsert({
            user_id: this.user.id,
            day: today,
            tasks_added: this.stats.tasksAddedToday || 0,
            tasks_completed: this.stats.tasksCompletedToday || 0,
            tasks_eliminated: this.stats.tasksEliminatedToday || 0,
            focus_sessions: this.stats.focusSessionsToday || 0
          }, {
            onConflict: 'user_id,day'
          });
        
        if (error) {
          console.error('Error saving stats:', error);
        }
      } catch (error) {
        console.error('Error saving stats:', error);
      }
    }
    localStorage.setItem('focusmatrix_ultimate_stats', JSON.stringify(this.stats));
  }

  /* ====================== EVENT BINDINGS ====================== */
  bindEvents() {
    /* Task input */
    document.getElementById('burger').addEventListener('click', () => {
      document.getElementById('mobileNav').classList.toggle('show');
    });
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

  editTask(task) {
    const el = document.querySelector(`[data-task-id="${task.id}"]`);
    if (!el) return;
    
    const taskTextEl = el.querySelector('.task-text');
    const currentText = task.text;
    
    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'task-edit-input';
    input.maxLength = 200;
    
    // Replace text with input
    taskTextEl.innerHTML = '';
    taskTextEl.appendChild(input);
    input.focus();
    input.select();
    
    const saveEdit = async () => {
      const newText = this.sanitizeText(input.value.trim());
      if (newText && newText !== currentText) {
        task.text = newText;
        await this.saveTasks();
        this.showFeedback('Task updated!', 'success');
      }
      this.renderAllTasks();
    };
    
    const cancelEdit = () => {
      this.renderAllTasks();
    };
    
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });
  }

  handleQuadrant4(task) {
    setTimeout(() => {
      if (confirm(`Let go of "${task.text}"?`)) {
        this.deleteTask(task.id);
      }
    }, 300);
  }

  async deleteTask(id, viaSwipe = false) {
    console.log('🗑️ Deleting task:', id, '| Via swipe:', viaSwipe);
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      console.log('❌ Task not found:', id);
      return;
    }
    const t = this.tasks[idx];
    console.log('📋 Task to delete:', JSON.stringify(t, null, 2));
    const el = document.querySelector(`[data-task-id="${id}"]`);

    const finish = async () => {
      // Delete from database if task has a database ID
      if (this.isOnline && t.database_id) {
        console.log('🗄️ Deleting from database - Task ID:', t.database_id);
        try {
          const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', t.database_id);
          
          if (error) {
            console.error('❌ Error deleting task from database:', error);
          } else {
            console.log('✅ Successfully deleted task from database');
          }
        } catch (error) {
          console.error('💥 Exception deleting task:', error);
        }
      } else {
        console.log('📱 Offline or no database_id - skipping database delete');
      }
      
      // Remove from local array
      console.log('📝 Removing from local array...');
      this.tasks.splice(idx, 1);
      console.log('📊 Tasks remaining:', this.tasks.length);
      
      // Update stats
      if (t.quadrant === 4) {
        this.stats.tasksEliminatedToday++;
        this.stats.totalEliminated++;
        console.log('📈 Updated elimination stats');
      } else {
        this.stats.tasksCompletedToday++;
        console.log('📈 Updated completion stats');
      }
      
      // Save updated data
      console.log('💾 Saving updated tasks and stats...');
      localStorage.setItem('focusmatrix_ultimate_tasks', JSON.stringify(this.tasks));
      await this.saveStats();
      this.updateDashboard();
      this.checkAchievements();
      console.log('✅ Delete operation completed');
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
