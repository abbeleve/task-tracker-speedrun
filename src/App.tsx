import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task, Template } from './types';
import { DEFAULT_EMOJI, DEFAULT_COLOR, TASK_COLORS, TASK_EMOJIS } from './types';
import { useTimer, formatTime, formatDelta } from './useTimer';
import './App.css';

let nextId = 1;
const uid = () => `t-${nextId++}-${Date.now()}`;

const PRESETS: { name: string; plannedTime: number }[] = [
  { name: 'Setup', plannedTime: 120 },
  { name: 'Planning', plannedTime: 300 },
  { name: 'Development', plannedTime: 1800 },
  { name: 'Testing', plannedTime: 600 },
  { name: 'Review', plannedTime: 300 },
  { name: 'Deploy', plannedTime: 180 },
];

const MIN_BLOCK_PX = 56;
const MAX_BLOCK_PX = 160;

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newName, setNewName] = useState('');
  const [newMinutes, setNewMinutes] = useState('5');
  const [newEmoji, setNewEmoji] = useState(DEFAULT_EMOJI);
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showPresets, setShowPresets] = useState(true);
  const [savedTemplates, setSavedTemplates] = useState<Template[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [timeCredit, setTimeCredit] = useState(0); // seconds saved from early future-task completions
  
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const { elapsed, sessionState, start, pause, resume, reset, finish, seek } = useTimer();
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  useEffect(() => {
    const stored = localStorage.getItem('speedrun_templates');
    if (stored) {
      try {
        setSavedTemplates(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load templates', e);
      }
    }
  }, []);

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.order - b.order), [tasks]);
  const sessionElapsedSec = elapsed / 1000;

  const cumulativeTimes = useMemo(() => {
    const arr: number[] = [];
    let cum = 0;
    for (const t of sortedTasks) {
      arr.push(cum);
      cum += t.plannedTime;
    }
    return arr;
  }, [sortedTasks]);

  const totalPlannedSec = useMemo(
    () => sortedTasks.reduce((s, t) => s + t.plannedTime, 0),
    [sortedTasks]
  );

  const maxPlannedSec = useMemo(
    () => sortedTasks.reduce((max, t) => Math.max(max, t.plannedTime), 0),
    [sortedTasks]
  );

  const blockHeight = useCallback(
    (plannedTime: number) => {
      if (maxPlannedSec <= 0) return MIN_BLOCK_PX;
      const proportion = plannedTime / maxPlannedSec;
      return MIN_BLOCK_PX + (MAX_BLOCK_PX - MIN_BLOCK_PX) * Math.sqrt(proportion);
    },
    [maxPlannedSec]
  );

  const timelineHeight = useMemo(() => {
    return sortedTasks.reduce((sum, t) => sum + blockHeight(t.plannedTime), 0);
  }, [sortedTasks, blockHeight]);

  // Pixels → time converter for scrubbing (stable ref, refreshed each render)
  const calcTimeFromPxRef = useRef<(px: number) => number>(() => 0);
  calcTimeFromPxRef.current = (px: number) => {
    let remaining = Math.max(0, px);
    let time = 0;
    for (let i = 0; i < sortedTasks.length; i++) {
      const t = sortedTasks[i];
      const bH = blockHeight(t.plannedTime);
      if (remaining <= bH) {
        time += (remaining / bH) * t.plannedTime;
        break;
      }
      remaining -= bH;
      time += t.plannedTime;
    }
    return time;
  };

  const taskLayout = useMemo(() => {
    const layout: { offset: number; height: number }[] = [];
    let offset = 0;
    for (const t of sortedTasks) {
      const h = blockHeight(t.plannedTime);
      layout.push({ offset, height: h });
      offset += h;
    }
    return layout;
  }, [sortedTasks, blockHeight]);

  const currentTaskIdx = useMemo(
    () => sortedTasks.findIndex((t) => t.completedAt === null),
    [sortedTasks]
  );

  // Task whose time window contains the current elapsed time (for thermo color)
  const currentTaskByTime = useMemo(() => {
    if (sortedTasks.length === 0) return null;
    let acc = 0;
    for (const t of sortedTasks) {
      if (sessionElapsedSec < acc + t.plannedTime) return t;
      acc += t.plannedTime;
    }
    return sortedTasks[sortedTasks.length - 1];
  }, [sortedTasks, sessionElapsedSec]);

  const timeToNextTask = useMemo(() => {
    if (sessionState === 'idle' || sortedTasks.length === 0) return null;
    // Find first uncompleted task
    let firstIdx = -1;
    for (let i = 0; i < sortedTasks.length; i++) {
      if (sortedTasks[i].completedAt === null) {
        firstIdx = i;
        break;
      }
    }
    if (firstIdx < 0) return null;
    // Find next uncompleted task after the first
    let nextIdx = -1;
    for (let i = firstIdx + 1; i < sortedTasks.length; i++) {
      if (sortedTasks[i].completedAt === null) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx < 0) return null;
    const nextTaskStart = cumulativeTimes[nextIdx];
    const remaining = nextTaskStart * 1000 - elapsed;
    return remaining;
  }, [sortedTasks, cumulativeTimes, elapsed, sessionState]);

  const calcPlayheadPx = useCallback(() => {
    let sec = sessionElapsedSec;
    let px = 0;
    for (let i = 0; i < sortedTasks.length; i++) {
      const t = sortedTasks[i];
      const bH = blockHeight(t.plannedTime);
      const secInBlock = t.plannedTime;
      if (sec <= secInBlock) {
        px += (sec / secInBlock) * bH;
        break;
      }
      sec -= secInBlock;
      px += bH;
    }
    return px;
  }, [sortedTasks, blockHeight, sessionElapsedSec]);

  useEffect(() => {
    if (sessionState !== 'running' && sessionState !== 'paused') return;
    const px = calcPlayheadPx();
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateY(${px}px)`;
    }
    if (fillRef.current) {
      fillRef.current.style.height = `${px}px`;
      if (currentTaskByTime) {
        fillRef.current.style.background = currentTaskByTime.color;
      }
    }
  }, [sessionElapsedSec, sortedTasks, sessionState, blockHeight, calcPlayheadPx, currentTaskByTime]);

  useEffect(() => {
    if (sessionState === 'idle' && fillRef.current) {
      fillRef.current.style.height = '0px';
      fillRef.current.style.background = '';
    }
    if (sessionState === 'idle' && playheadRef.current) {
      playheadRef.current.style.transform = 'translateY(0px)';
    }
  }, [sessionState]);

  useEffect(() => {
    if (sessionState === 'running' && playheadRef.current) {
      playheadRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }, [currentTaskIdx, sessionState]);

  // Time scrubbing — drag on timeline tracks to seek
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;

    let scrubbing = false;

    const getTimeFromEvent = (e: MouseEvent): number => {
      const tracksEl = container.querySelector('.timeline-tracks') as HTMLElement;
      if (!tracksEl) return 0;
      const tracksRect = tracksEl.getBoundingClientRect();
      const px = e.clientY - tracksRect.top + container.scrollTop;
      return calcTimeFromPxRef.current(px);
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, a, .task-block[draggable="true"]')) return;
      if (sessionStateRef.current === 'idle') return;

      scrubbing = true;
      if (sessionStateRef.current === 'running') pauseRef.current();

      const time = getTimeFromEvent(e);
      seekRef.current(time * 1000);
      e.preventDefault();
      container.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!scrubbing) return;
      const time = getTimeFromEvent(e);
      seekRef.current(time * 1000);
    };

    const onMouseUp = () => {
      if (!scrubbing) return;
      scrubbing = false;
      container.style.cursor = '';
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const addTask = useCallback(
    (name: string, plannedTime: number, emoji: string, color: string) => {
      if (!name.trim() || plannedTime <= 0) return;
      const task: Task = {
        id: uid(),
        name: name.trim(),
        plannedTime,
        completedAt: null,
        order: tasks.length,
        emoji: emoji || DEFAULT_EMOJI,
        color: color || DEFAULT_COLOR,
      };
      setTasks((prev) => [...prev, task]);
    },
    [tasks.length]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      addTask(newName, Math.max(1, Math.round(parseFloat(newMinutes) * 60)), newEmoji, newColor);
      setNewName('');
      setNewMinutes('5');
      setNewEmoji(DEFAULT_EMOJI);
      setNewColor(DEFAULT_COLOR);
    },
    [addTask, newName, newMinutes, newEmoji, newColor]
  );

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      return filtered.map((t, i) => ({ ...t, order: i }));
    });
  }, []);

  const clearAllTasks = useCallback(() => {
    setTasks([]);
    reset();
    setShowPresets(true);
    setTimeCredit(0);
  }, [reset]);

  const saveTemplate = useCallback(() => {
    if (sortedTasks.length === 0) return;
    const templateName = prompt('Enter template name:');
    if (!templateName) return;

    const newTemplate: Template = {
      id: uid(),
      name: templateName,
      tasks: sortedTasks.map(t => ({ name: t.name, plannedTime: t.plannedTime, emoji: t.emoji, color: t.color })),
    };

    const updated = [...savedTemplates, newTemplate];
    setSavedTemplates(updated);
    localStorage.setItem('speedrun_templates', JSON.stringify(updated));
  }, [savedTemplates, sortedTasks]);

  const loadTemplate = useCallback((template: Template) => {
    reset();
    setSessionStartTime(null);
    setTimeCredit(0);
    const newTasks: Task[] = template.tasks.map((t, i) => ({
      id: uid(),
      name: t.name,
      plannedTime: t.plannedTime,
      completedAt: null,
      order: i,
      emoji: t.emoji || DEFAULT_EMOJI,
      color: t.color || DEFAULT_COLOR,
    }));
    setTasks(newTasks);
    setShowPresets(false);
  }, [reset]);

  const deleteTemplate = useCallback((id: string) => {
    const updated = savedTemplates.filter(t => t.id !== id);
    setSavedTemplates(updated);
    localStorage.setItem('speedrun_templates', JSON.stringify(updated));
  }, [savedTemplates]);

  const exportTemplates = useCallback(() => {
    if (savedTemplates.length === 0) return;
    const dataStr = JSON.stringify(savedTemplates, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = 'speedrun-templates.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }, [savedTemplates]);

  const importTemplates = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        if (Array.isArray(imported) && imported.every(t => t.name && t.tasks)) {
          const updated = [...savedTemplates, ...imported];
          // Deduplicate by name or ID if necessary, but for now simple merge
          setSavedTemplates(updated);
          localStorage.setItem('speedrun_templates', JSON.stringify(updated));
          alert('Templates imported successfully!');
        } else {
          alert('Invalid template file format.');
        }
      } catch (err) {
        alert('Error reading template file.');
      }
    };
    reader.readAsText(file);
  }, [savedTemplates]);

  const completeTask = useCallback(
    (id: string) => {
      if (sessionState !== 'running') return;

      // Check if completing a future task (there are uncompleted tasks before it)
      const sorted = [...tasks].sort((a, b) => a.order - b.order);
      const taskIdx = sorted.findIndex((t) => t.id === id);
      if (taskIdx === -1) return;
      const firstUncompletedIdx = sorted.findIndex((t) => t.completedAt === null);

      if (firstUncompletedIdx >= 0 && firstUncompletedIdx < taskIdx) {
        // Completing a future task early — add saved time as credit
        let plannedStart = 0;
        for (let i = 0; i < taskIdx; i++) {
          plannedStart += sorted[i].plannedTime;
        }
        const plannedEnd = plannedStart + sorted[taskIdx].plannedTime;
        const timeSaved = plannedEnd - sessionElapsedSec;

        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, completedAt: sessionElapsedSec } : t))
        );

        if (timeSaved > 0) {
          setTimeCredit((prev) => prev + timeSaved);
        }
        return;
      }

      // Normal completion
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completedAt: sessionElapsedSec } : t))
      );
    },
    [sessionState, sessionElapsedSec, tasks]
  );

  const uncompleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (!task || task.completedAt === null) return prev;

      // If this was a future completion, subtract its timeSaved from credit
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const taskIdx = sorted.findIndex((t) => t.id === id);
      const hasUncompletedBefore = sorted.slice(0, taskIdx).some((t) => t.completedAt === null);

      if (hasUncompletedBefore && task.completedAt !== null) {
        let plannedStart = 0;
        for (let i = 0; i < taskIdx; i++) {
          plannedStart += sorted[i].plannedTime;
        }
        const plannedEnd = plannedStart + task.plannedTime;
        const timeSaved = plannedEnd - task.completedAt;
        if (timeSaved > 0) {
          setTimeCredit((c) => Math.max(0, c - timeSaved));
        }
      }

      return prev.map((t) => (t.id === id ? { ...t, completedAt: null } : t));
    });
  }, []);

  const moveTask = useCallback((fromIdx: number, toIdx: number) => {
    setTasks((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      return sorted.map((t, i) => ({ ...t, order: i }));
    });
  }, []);

  const loadPresets = useCallback(() => {
    setTasks([]);
    setTimeCredit(0);
    const pts = PRESETS.map((p, i) => ({
      id: uid(),
      name: p.name,
      plannedTime: p.plannedTime,
      completedAt: null,
      order: i,
      emoji: TASK_EMOJIS[i % TASK_EMOJIS.length],
      color: TASK_COLORS[i % TASK_COLORS.length],
    }));
    setTasks(pts);
    setShowPresets(false);
  }, []);

  const handleReset = useCallback(() => {
    reset();
    setTasks((prev) => prev.map((t) => ({ ...t, completedAt: null })));
    setSessionStartTime(null);
    setTimeCredit(0);
  }, [reset]);

  const handleSessionAction = useCallback(() => {
    if (sessionState === 'idle') {
      if (sortedTasks.length === 0) return;
      setSessionStartTime(Date.now());
      setTimeCredit(0);
      start();
    } else if (sessionState === 'running') {
      pause();
    } else if (sessionState === 'paused') {
      resume();
    }
  }, [sessionState, sortedTasks.length, start, pause, resume]);

  const allCompleted = sortedTasks.length > 0 && sortedTasks.every((t) => t.completedAt !== null);

  useEffect(() => {
    if (allCompleted && sessionState === 'running') {
      finish();
    }
  }, [allCompleted, sessionState, finish]);

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const onDrop = (toIdx: number) => {
    if (dragIdx !== null && dragIdx !== toIdx) {
      moveTask(dragIdx, toIdx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const onDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const formatRealTime = (secondsFromStart: number) => {
    if (sessionStartTime === null) return null;
    const date = new Date(sessionStartTime + secondsFromStart * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const rulerMarks = useMemo(() => {
    if (totalPlannedSec <= 0 || sortedTasks.length === 0) return [];
    const marks: { sec: number; label: string; px: number }[] = [];
    let interval: number;
    if (totalPlannedSec <= 600) interval = 60;
    else if (totalPlannedSec <= 1800) interval = 300;
    else if (totalPlannedSec <= 3600) interval = 600;
    else interval = 1800;

    let nextMark = interval;
    let secAccum = 0;
    let pxAccum = 0;
    for (let i = 0; i < sortedTasks.length; i++) {
      const t = sortedTasks[i];
      const bH = blockHeight(t.plannedTime);
      const blockSec = t.plannedTime;
      while (nextMark <= secAccum + blockSec) {
        const secIntoBlock = nextMark - secAccum;
        const pxIntoBlock = (secIntoBlock / blockSec) * bH;
        marks.push({
          sec: nextMark,
          label: formatTime(nextMark * 1000, false),
          px: pxAccum + pxIntoBlock,
        });
        nextMark += interval;
      }
      secAccum += blockSec;
      pxAccum += bH;
    }
    return marks;
  }, [sortedTasks, totalPlannedSec, blockHeight]);

  const showPlayhead = sessionState === 'running' || sessionState === 'paused';

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="icon">⏱</span> SpeedRun Tasks
        </h1>
        <div className="session-controls">
          {sessionState === 'idle' && (
            <>
              <button
                className="btn btn-start"
                onClick={handleSessionAction}
                disabled={sortedTasks.length === 0}
              >
                ▶ Start Run
              </button>
              {sortedTasks.length > 0 && (
                <>
                  <button
                    className="btn btn-save-template"
                    onClick={saveTemplate}
                    title="Save current tasks as template"
                  >
                    💾 Save Template
                  </button>
                  <button className="btn btn-clear" onClick={clearAllTasks} title="Remove all tasks">
                    🗑 Clear All
                  </button>
                </>
              )}
            </>
          )}
          {sessionState === 'running' && (
            <button className="btn btn-pause" onClick={handleSessionAction}>
              ⏸ Pause
            </button>
          )}
          {sessionState === 'paused' && (
            <>
              <button className="btn btn-resume" onClick={handleSessionAction}>
                ▶ Resume
              </button>
              <button className="btn btn-reset" onClick={handleReset}>
                ↺ Reset
              </button>
              {sortedTasks.length > 0 && (
                <button
                  className="btn btn-save-template"
                  onClick={saveTemplate}
                  title="Save current tasks as template"
                >
                  💾 Save Template
                </button>
              )}
            </>
          )}
          {sessionState === 'finished' && (
            <>
              <button className="btn btn-reset" onClick={handleReset}>
                ↺ New Run
              </button>
              {sortedTasks.length > 0 && (
                <button
                  className="btn btn-save-template"
                  onClick={saveTemplate}
                  title="Save current tasks as template"
                >
                  💾 Save Template
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {sessionState === 'idle' && (
        <div className="add-section">
          <form className="add-form" onSubmit={handleSubmit}>
            <div className="emoji-picker">
              {TASK_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`emoji-opt ${newEmoji === em ? 'active' : ''}`}
                  onClick={() => setNewEmoji(em)}
                >
                  {em}
                </button>
              ))}
            </div>
            <div className="add-row">
              <span className="selected-emoji">{newEmoji}</span>
              <input
                type="text"
                placeholder="Task name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input-name"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="min"
                value={newMinutes}
                onChange={(e) => setNewMinutes(e.target.value)}
                className="input-minutes"
              />
              <span className="input-label">min</span>
              <div className="color-picker">
                {TASK_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-opt ${newColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <button type="submit" className="btn btn-add">
                + Add
              </button>
            </div>
          </form>

          <div className="templates-section">
            <div className="templates-header">
              <span className="templates-title">Templates</span>
              <div className="templates-global-actions">
                <button
                  className="btn btn-export-tpl"
                  onClick={exportTemplates}
                  title="Export all templates to JSON file"
                >
                  📤 Export
                </button>
                <label className="btn btn-import-tpl">
                  📥 Import
                  <input
                    type="file"
                    accept=".json"
                    onChange={importTemplates}
                    style={{ display: 'none' }}
                  />
                </label>
                {showPresets && sortedTasks.length === 0 && (
                  <button className="btn btn-presets" onClick={loadPresets}>
                    🎮 Load Example Splits
                  </button>
                )}
              </div>
            </div>
            <div className="templates-grid">
              {savedTemplates.map((tpl) => (
                <div key={tpl.id} className="template-card">
                  <div className="template-info">
                    <span className="template-name">{tpl.name}</span>
                    <span className="template-count">{tpl.tasks.length} tasks</span>
                  </div>
                  <div className="template-actions">
                    <button className="btn btn-load-tpl" onClick={() => loadTemplate(tpl)}>
                      Load
                    </button>
                    <button className="btn btn-del-tpl" onClick={() => deleteTemplate(tpl.id)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {savedTemplates.length === 0 && !showPresets && (
                <p className="templates-empty">No saved templates yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="timeline-container" ref={timelineRef}>
        {sortedTasks.length === 0 && sessionState === 'idle' ? (
          <div className="empty-state">
            <p>Add tasks to create your speedrun splits</p>
            <p className="hint">Each task = one split with a planned time. Height = sqrt-scaled for visual balance.</p>
          </div>
        ) : (
          <div className="timeline-inner">
            {/* Time ruler */}
            <div className="timeline-ruler" style={{ height: timelineHeight }}>
              <div className="ruler-zero">
                <span className="ruler-label">0:00</span>
                <div className="ruler-tick" />
              </div>
              {rulerMarks.map((m) => (
                <div key={m.sec} className="ruler-mark" style={{ top: m.px }}>
                  <span className="ruler-label">{m.label}</span>
                  <div className="ruler-tick" />
                </div>
              ))}
            </div>

            {/* Thermometer column */}
            <div className="timeline-thermo" style={{ height: timelineHeight }}>
              <div className="thermo-track" />
              <div className="thermo-fill" ref={fillRef} />
              {sortedTasks.map((task, idx) => {
                const dotSec = cumulativeTimes[idx];
                const dotPx = taskLayout[idx].offset;
                const filled = sessionState !== 'idle' && sessionElapsedSec >= dotSec;
                return (
                  <div
                    key={idx}
                    className={`thermo-dot ${filled ? 'filled' : ''}`}
                    style={{ top: dotPx, '--dot-color': task.color } as React.CSSProperties}
                    title={task.name}
                  >
                    <span className="thermo-dot-emoji">{task.emoji}</span>
                  </div>
                );
              })}
              {showPlayhead && (
                <div className="thermo-marker" ref={playheadRef}>
                  <div className="thermo-marker-dot" />
                  <div className="thermo-marker-glow" />
                </div>
              )}
            </div>

            {/* Task blocks */}
            <div className="timeline-tracks" style={{ height: timelineHeight }}>
              {/* thermo-fill moved to thermo column */}

              {sortedTasks.map((task, idx) => {
                const layout = taskLayout[idx];
                const isCompleted = task.completedAt !== null;
                const isCurrent = idx === currentTaskIdx && sessionState !== 'idle';
                const plannedStartSec = cumulativeTimes[idx];
                const plannedEndSec = plannedStartSec + task.plannedTime;

                let delta: number | null = null;
                if (isCompleted && task.completedAt !== null) {
                  delta = (task.completedAt - plannedEndSec) * 1000;
                } else if (isCurrent && sessionState === 'running') {
                  const actualProgressSec = sessionElapsedSec - plannedStartSec;
                  const remainingPlanned = task.plannedTime - actualProgressSec;
                  delta = -(remainingPlanned + timeCredit) * 1000;
                }

                let segmentTime: string | null = null;
                if (isCompleted && task.completedAt !== null) {
                  let prevCompletedAt = 0;
                  for (let i = idx - 1; i >= 0; i--) {
                    if (sortedTasks[i].completedAt !== null) {
                      prevCompletedAt = sortedTasks[i].completedAt!;
                      break;
                    }
                  }
                  segmentTime = formatTime((task.completedAt - prevCompletedAt) * 1000, true);
                }

                return (
                  <div
                    key={task.id}
                    className={`task-block ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${dragIdx === idx ? 'dragging' : ''} ${dragOverIdx === idx && dragIdx !== idx ? 'drag-over' : ''}`}
                    style={{ top: layout.offset, height: layout.height, '--task-color': task.color } as React.CSSProperties}
                    draggable={sessionState === 'idle'}
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDrop={() => onDrop(idx)}
                    onDragEnd={onDragEnd}
                  >
                    <div className="block-left">
                      {sessionState === 'idle' && (
                        <span className="drag-handle" title="Drag to reorder">⠿</span>
                      )}
                      <span className="task-emoji">{task.emoji}</span>
                      <div className="block-info">
                        <span className="task-planned-lg">
                          {formatTime(task.plannedTime * 1000, false)}
                        </span>
                        <span className="task-name">{task.name}</span>
                        <span
                          className={`task-delta ${delta !== null && delta < 0 ? 'ahead' : ''} ${delta !== null && delta > 0 ? 'behind' : ''}`}
                        >
                          {delta !== null ? formatDelta(delta) : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="block-right">
                      <span className="task-segment">{segmentTime ?? '—'}</span>
                      {sessionStartTime !== null && (
                        <span className="task-realtime">
                          {formatRealTime(plannedEndSec)}
                        </span>
                      )}
                      <div className="task-actions">
                        {!isCompleted && sessionState === 'running' && (
                          <button
                            className="btn btn-complete"
                            onClick={() => completeTask(task.id)}
                            title="Complete split"
                          >
                            ✓
                          </button>
                        )}
                        {isCompleted && (sessionState === 'running' || sessionState === 'paused') && (
                          <button
                            className="btn btn-undo"
                            onClick={() => uncompleteTask(task.id)}
                            title="Undo"
                          >
                            ↩
                          </button>
                        )}
                        {sessionState === 'idle' && (
                          <button
                            className="btn btn-remove"
                            onClick={() => removeTask(task.id)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {sortedTasks.length > 0 && (
                <div className="finish-line" style={{ top: timelineHeight }}>
                  <span className="finish-label">🏁 Finish</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="footer">
        <div className="timer-block timer-next">
          <span className="timer-label">⏳ Next Task</span>
          <span
            className={`timer-value ${timeToNextTask !== null && timeToNextTask < 0 ? 'behind' : 'ahead'}`}
          >
            {timeToNextTask !== null ? formatTime(Math.abs(timeToNextTask), true) : '—'}
            {timeToNextTask !== null && timeToNextTask < 0 ? ' OVERDUE' : ''}
          </span>
        </div>
        <div className="timer-block timer-session">
          <span className="timer-label">⏱ Session</span>
          <span className="timer-value timer-main">{formatTime(elapsed, true)}</span>
          <span className="timer-planned">
            Planned: {formatTime(totalPlannedSec * 1000, false)}
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
