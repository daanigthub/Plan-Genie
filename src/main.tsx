import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import './app.css';

type IntakeData = {
  roundTables: number;
  rectangularTables: number;
  chairs: number;
  roomWidth: number;
  roomLength: number;
};

type ObjectKind =
  | 'round-table'
  | 'rectangular-table'
  | 'stage'
  | 'buffet'
  | 'door'
  | 'zone';

type LayoutObject = {
  id: string;
  kind: ObjectKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type StartingLayout = IntakeData & {
  objects: LayoutObject[];
};

type TimelineBlock = {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
};

type ObjectBlockState = {
  x: number;
  y: number;
  removed: boolean;
};

type TimelineState = {
  blocks: TimelineBlock[];
  objectStates: Record<string, Record<string, ObjectBlockState>>;
};

type StoredLayout = StartingLayout & {
  timeline: TimelineState;
};

const defaultTimelineBlocks: TimelineBlock[] = [
  { id: 'talk', label: 'Talk', startMinutes: 360, endMinutes: 395 },
  { id: 'dinner', label: 'Dinner', startMinutes: 395, endMinutes: 420 },
  { id: 'prayer', label: 'Prayer', startMinutes: 420, endMinutes: 440 },
];

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(remainingMinutes).padStart(2, '0')} ${period}`;
}

function createTimeline(objects: LayoutObject[]): TimelineState {
  return {
    blocks: defaultTimelineBlocks.map((block) => ({ ...block })),
    objectStates: Object.fromEntries(
      defaultTimelineBlocks.map((block) => [
        block.id,
        Object.fromEntries(
          objects.map((object) => [
            object.id,
            { x: object.x, y: object.y, removed: false },
          ]),
        ),
      ]),
    ),
  };
}

function withTimeline(
  layout: StartingLayout & { timeline?: TimelineState },
): StoredLayout {
  const timeline = layout.timeline ?? createTimeline(layout.objects);
  const objectStates = Object.fromEntries(
    timeline.blocks.map((block) => [
      block.id,
      Object.fromEntries(
        layout.objects.map((object) => [
          object.id,
          timeline.objectStates[block.id]?.[object.id] ?? {
            x: object.x,
            y: object.y,
            removed: false,
          },
        ]),
      ),
    ]),
  );

  return {
    ...layout,
    timeline: {
      blocks: timeline.blocks.map((block) => ({ ...block })),
      objectStates,
    },
  };
}

function generateStartingLayout(intake: IntakeData): StartingLayout {
  const margin = Math.min(4, intake.roomWidth / 10, intake.roomLength / 10);
  const stageWidth = Math.min(16, intake.roomWidth * 0.3);
  const stageHeight = Math.min(4, intake.roomLength * 0.1);
  const doorWidth = Math.min(1.5, intake.roomWidth * 0.05);
  const doorHeight = Math.min(4, intake.roomLength * 0.12);
  const tableCount = intake.roundTables + intake.rectangularTables;
  const usableWidth = Math.max(intake.roomWidth - margin * 2, 1);
  const usableLength = Math.max(
    intake.roomLength - margin * 2 - stageHeight - 4,
    1,
  );
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt((tableCount * usableWidth) / usableLength)),
  );
  const rows = Math.max(1, Math.ceil(tableCount / columns));
  const cellWidth = usableWidth / columns;
  const cellHeight = usableLength / rows;
  const objects: LayoutObject[] = [
    {
      id: 'stage',
      kind: 'stage',
      label: 'Stage',
      x: (intake.roomWidth - stageWidth) / 2,
      y: margin,
      width: stageWidth,
      height: stageHeight,
    },
    {
      id: 'entrance',
      kind: 'door',
      label: 'Entrance',
      x: 0,
      y: (intake.roomLength - doorHeight) / 2,
      width: doorWidth,
      height: doorHeight,
    },
  ];

  const tableObjects = [
    ...Array.from({ length: intake.roundTables }, (_, index) => ({
      kind: 'round-table' as const,
      label: `Round table ${index + 1}`,
      widthRatio: 0.72,
      heightRatio: 0.72,
    })),
    ...Array.from({ length: intake.rectangularTables }, (_, index) => ({
      kind: 'rectangular-table' as const,
      label: `Rectangular table ${index + 1}`,
      widthRatio: 0.82,
      heightRatio: 0.52,
    })),
  ];

  tableObjects.forEach((table, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const width = Math.min(cellWidth * table.widthRatio, usableWidth);
    const height = Math.min(cellHeight * table.heightRatio, usableLength);

    objects.push({
      id: `${table.kind}-${index + 1}`,
      kind: table.kind,
      label: table.label,
      x: margin + column * cellWidth + (cellWidth - width) / 2,
      y: margin + stageHeight + 4 + row * cellHeight + (cellHeight - height) / 2,
      width,
      height,
    });
  });

  return { ...intake, objects };
}

function getSavedLayout(): StoredLayout | null {
  try {
    const saved = sessionStorage.getItem('planGenie.layout');
    return saved
      ? withTimeline(JSON.parse(saved) as StartingLayout & {
          timeline?: TimelineState;
        })
      : null;
  } catch {
    return null;
  }
}

const toolDefinitions: Array<{ kind: ObjectKind; label: string }> = [
  { kind: 'round-table', label: 'Round table' },
  { kind: 'rectangular-table', label: 'Rectangular table' },
  { kind: 'stage', label: 'Stage' },
  { kind: 'buffet', label: 'Buffet station' },
  { kind: 'door', label: 'Entrance / exit' },
  { kind: 'zone', label: 'Labeled zone' },
];

function newObject(
  kind: ObjectKind,
  roomWidth: number,
  roomLength: number,
  objectNumber: number,
): LayoutObject {
  const defaults: Record<
    ObjectKind,
    { label: string; width: number; height: number }
  > = {
    'round-table': { label: 'Round table', width: 6, height: 6 },
    'rectangular-table': {
      label: 'Rectangular table',
      width: 8,
      height: 4,
    },
    stage: { label: 'Stage', width: 16, height: 4 },
    buffet: { label: 'Buffet station', width: 6, height: 3 },
    door: { label: 'Entrance / exit', width: 1.5, height: 4 },
    zone: { label: 'New zone', width: 12, height: 10 },
  };
  const object = defaults[kind];
  const width = Math.min(object.width, roomWidth);
  const height = Math.min(object.height, roomLength);

  return {
    id: `${kind}-${Date.now()}-${objectNumber}`,
    kind,
    label: object.label,
    x: Math.max(0, (roomWidth - width) / 2),
    y: Math.max(0, (roomLength - height) / 2),
    width,
    height,
  };
}

function Editor() {
  const [layout, setLayout] = useState<StoredLayout | null>(getSavedLayout);
  const [dragging, setDragging] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineStart = layout?.timeline.blocks[0]?.startMinutes ?? 0;
  const timelineEnd =
    layout?.timeline.blocks[layout.timeline.blocks.length - 1]?.endMinutes ??
    timelineStart;
  const [playheadMinutes, setPlayheadMinutes] = useState(timelineStart);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  useEffect(() => {
    if (layout) {
      sessionStorage.setItem('planGenie.layout', JSON.stringify(layout));
    }
  }, [layout]);

  useEffect(() => {
    if (!dragging || !layout) {
      return;
    }
    const activeDrag = dragging;
    const activeLayout = layout;

    function handlePointerMove(event: PointerEvent) {
      const room = roomRef.current;
      if (!room) {
        return;
      }

      const bounds = room.getBoundingClientRect();
      const pointerX =
        ((event.clientX - bounds.left) / bounds.width) * activeLayout.roomWidth;
      const pointerY =
        ((event.clientY - bounds.top) / bounds.height) * activeLayout.roomLength;
      const snap = (value: number) => Math.round(value / 2) * 2;
      const nextX = Math.max(
        0,
        Math.min(
          activeLayout.roomWidth - activeDrag.width,
          snap(pointerX - activeDrag.offsetX),
        ),
      );
      const nextY = Math.max(
        0,
        Math.min(
          activeLayout.roomLength - activeDrag.height,
          snap(pointerY - activeDrag.offsetY),
        ),
      );

      setLayout((current) =>
        current
          ? {
              ...current,
              objects: current.objects.map((object) =>
                object.id === activeDrag.id
                  ? { ...object, x: nextX, y: nextY }
                  : object,
              ),
            }
          : current,
      );
    }

    function handlePointerUp() {
      setDragging(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragging, layout?.roomWidth, layout?.roomLength]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const startedAt = performance.now();
    const duration = 15000;
    let animationFrame = 0;
    setPlayheadMinutes(timelineStart);

    function animate(now: number) {
      const progress = Math.min(1, (now - startedAt) / duration);
      setPlayheadMinutes(
        timelineStart + (timelineEnd - timelineStart) * progress,
      );

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setIsPlaying(false);
      }
    }

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, timelineEnd, timelineStart]);

  useEffect(() => {
    if (!isScrubbing) {
      return;
    }

    function handleTimelinePointerMove(event: PointerEvent) {
      const track = timelineRef.current;
      if (!track) {
        return;
      }

      const bounds = track.getBoundingClientRect();
      const position = Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / bounds.width),
      );
      setPlayheadMinutes(
        timelineStart + (timelineEnd - timelineStart) * position,
      );
    }

    function handleTimelinePointerUp() {
      setIsScrubbing(false);
    }

    window.addEventListener('pointermove', handleTimelinePointerMove);
    window.addEventListener('pointerup', handleTimelinePointerUp);
    return () => {
      window.removeEventListener('pointermove', handleTimelinePointerMove);
      window.removeEventListener('pointerup', handleTimelinePointerUp);
    };
  }, [isScrubbing, timelineEnd, timelineStart]);

  if (!layout) {
    return (
      <main className="placeholder-shell">
        <section className="placeholder-card" aria-labelledby="placeholder-title">
          <p className="eyebrow">Plan Genie</p>
          <h1 id="placeholder-title">No starting layout yet.</h1>
          <p className="placeholder-copy">
            Go back to the intake form to create one.
          </p>
          <a className="secondary-link" href="/app">
            Back to intake
          </a>
        </section>
      </main>
    );
  }

  function addObject(kind: ObjectKind) {
    setLayout((current) => {
      if (!current) {
        return current;
      }

      const object = newObject(
        kind,
        current.roomWidth,
        current.roomLength,
        current.objects.length + 1,
      );
      return { ...current, objects: [...current.objects, object] };
    });
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    object: LayoutObject,
  ) {
    if (event.button !== 0 || !roomRef.current || !layout) {
      return;
    }

    const bounds = roomRef.current.getBoundingClientRect();
    const roomWidth = layout.roomWidth;
    const roomLength = layout.roomLength;
    const pointerX =
      ((event.clientX - bounds.left) / bounds.width) * roomWidth;
    const pointerY =
      ((event.clientY - bounds.top) / bounds.height) * roomLength;

    event.preventDefault();
    setDragging({
      id: object.id,
      offsetX: pointerX - object.x,
      offsetY: pointerY - object.y,
      width: object.width,
      height: object.height,
    });
  }

  const currentBlock =
    layout.timeline.blocks.find(
      (block) =>
        playheadMinutes >= block.startMinutes &&
        playheadMinutes < block.endMinutes,
    ) ?? layout.timeline.blocks[layout.timeline.blocks.length - 1];
  const playheadProgress =
    timelineEnd === timelineStart
      ? 0
      : (playheadMinutes - timelineStart) / (timelineEnd - timelineStart);

  function handleTimelinePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const track = timelineRef.current;
    if (!track) {
      return;
    }

    const bounds = track.getBoundingClientRect();
    const position = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    setIsPlaying(false);
    setIsScrubbing(true);
    setPlayheadMinutes(
      timelineStart + (timelineEnd - timelineStart) * position,
    );
  }

  return (
    <main className="editor-shell">
      <header className="editor-header">
        <a className="back-link" href="/app">
          ← Intake
        </a>
        <div className="editor-brand">
          <span className="brand-spark" aria-hidden="true">
            ✦
          </span>
          <span>Plan Genie</span>
        </div>
        <div className="editor-room-meta">
          <strong>{layout.roomWidth} × {layout.roomLength} ft</strong>
          <span>Room plan</span>
        </div>
      </header>

      <div className="editor-body">
        <aside className="editor-sidebar" aria-label="Add objects">
          <div>
            <p className="sidebar-kicker">Editor</p>
            <h1>Build your room.</h1>
            <p className="sidebar-copy">
              Drag anything on the plan to move it. Objects align to a 2 ft
              grid.
            </p>
          </div>

          <div className="tool-list">
            <h2>Add to plan</h2>
            {toolDefinitions.map((tool) => (
              <button
                className="tool-button"
                key={tool.kind}
                type="button"
                onClick={() => addObject(tool.kind)}
              >
                <span className={`tool-swatch tool-${tool.kind}`} />
                {tool.label}
                <span className="tool-plus" aria-hidden="true">
                  +
                </span>
              </button>
            ))}
          </div>

          <div className="editor-sidebar-spacer" />
          <div className="object-count">
            <strong>{layout.objects.length}</strong>
            <span>Objects placed</span>
          </div>
        </aside>

        <section className="editor-workspace" aria-labelledby="plan-title">
          <div className="workspace-heading">
            <div>
              <p className="sidebar-kicker">Top-down view</p>
              <h2 id="plan-title">Main room</h2>
            </div>
            <div className="workspace-scale">
              <span className="scale-line" aria-hidden="true" />
              <span>2 ft grid</span>
            </div>
          </div>

          <div
            className="room-editor"
            ref={roomRef}
            style={
              {
                aspectRatio: `${layout.roomWidth} / ${layout.roomLength}`,
                '--grid-width': `${(2 / layout.roomWidth) * 100}%`,
                '--grid-height': `${(2 / layout.roomLength) * 100}%`,
              } as CSSProperties
            }
          >
            <span className="room-dimension room-dimension-width">
              {layout.roomWidth} ft
            </span>
            <span className="room-dimension room-dimension-length">
              {layout.roomLength} ft
            </span>
            {layout.objects.map((object) => (
              <div
                className={`editor-object editor-${object.kind}${
                  dragging?.id === object.id ? ' is-dragging' : ''
                }`}
                key={object.id}
                role="button"
                tabIndex={0}
                title={`${object.label} · drag to move`}
                aria-label={`${object.label}, drag to move`}
                onPointerDown={(event) => handlePointerDown(event, object)}
                style={{
                  left: `${(object.x / layout.roomWidth) * 100}%`,
                  top: `${(object.y / layout.roomLength) * 100}%`,
                  width: `${(object.width / layout.roomWidth) * 100}%`,
                  height: `${(object.height / layout.roomLength) * 100}%`,
                }}
              >
                {object.label}
              </div>
            ))}
          </div>
          <p className="workspace-note">
            Drag objects to position them. The layout saves in this browser.
          </p>
        </section>
      </div>

      <section className="timeline-dock" aria-label="Event timeline">
        <div className="timeline-inner">
          <div className="timeline-header">
            <div>
              <p className="sidebar-kicker">Event timeline</p>
              <strong>{currentBlock.label}</strong>
              <span> · {formatTime(Math.round(playheadMinutes))}</span>
            </div>
            <button
              className="timeline-play"
              type="button"
              onClick={() => setIsPlaying((playing) => !playing)}
              aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
            >
              <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>

          <div
            className="timeline-track"
            ref={timelineRef}
            onPointerDown={handleTimelinePointerDown}
            role="slider"
            aria-label="Event timeline position"
            aria-valuemin={timelineStart}
            aria-valuemax={timelineEnd}
            aria-valuenow={Math.round(playheadMinutes)}
            tabIndex={0}
          >
            <div className="timeline-segments">
              {layout.timeline.blocks.map((block) => (
                <div
                  className={`timeline-segment${
                    currentBlock.id === block.id ? ' is-current' : ''
                  }`}
                  key={block.id}
                  style={{
                    flex: `${block.endMinutes - block.startMinutes} 1 0%`,
                  }}
                >
                  <strong>{block.label}</strong>
                  <span>
                    {formatTime(block.startMinutes)}–{formatTime(block.endMinutes)}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="timeline-playhead"
              style={{ left: `${playheadProgress * 100}%` }}
              aria-hidden="true"
            >
              <span>{formatTime(Math.round(playheadMinutes))}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function IntakeForm() {
  const [roundTables, setRoundTables] = useState('');
  const [rectangularTables, setRectangularTables] = useState('');
  const [chairs, setChairs] = useState('');
  const [roomWidth, setRoomWidth] = useState('');
  const [roomLength, setRoomLength] = useState('');
  const [fileName, setFileName] = useState('');

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFileName(event.target.files?.[0]?.name ?? '');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const intake: IntakeData = {
      roundTables: Number(roundTables),
      rectangularTables: Number(rectangularTables),
      chairs: Number(chairs),
      roomWidth: Number(roomWidth),
      roomLength: Number(roomLength),
    };

    sessionStorage.setItem('planGenie.intake', JSON.stringify(intake));
    sessionStorage.setItem(
      'planGenie.layout',
      JSON.stringify(withTimeline(generateStartingLayout(intake))),
    );
    window.location.assign('/app/editor');
  }

  return (
    <main className="intake-shell">
      <div className="intake-topbar">
        <a className="back-link" href="/">
          ← Back to home
        </a>
        <span className="intake-step">Step 1 of 3</span>
      </div>

      <section className="intake-card" aria-labelledby="intake-title">
        <p className="eyebrow">Let’s set up your room</p>
        <h1 id="intake-title">Tell us what you’re working with.</h1>
        <p className="intake-intro">
          Add the basics and Plan Genie will give you a starting layout to
          adjust.
        </p>

        <form onSubmit={handleSubmit}>
          <fieldset>
            <legend>Furniture and seating</legend>
            <div className="field-grid">
              <label>
                <span>Round tables</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={roundTables}
                  onChange={(event) => setRoundTables(event.target.value)}
                  placeholder="e.g. 12"
                />
              </label>
              <label>
                <span>Rectangular tables</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={rectangularTables}
                  onChange={(event) =>
                    setRectangularTables(event.target.value)
                  }
                  placeholder="e.g. 4"
                />
              </label>
              <label>
                <span>Chairs</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={chairs}
                  onChange={(event) => setChairs(event.target.value)}
                  placeholder="e.g. 180"
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Room dimensions</legend>
            <div className="field-grid">
              <label>
                <span>Room width <small>(feet)</small></span>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  required
                  value={roomWidth}
                  onChange={(event) => setRoomWidth(event.target.value)}
                  placeholder="e.g. 72"
                />
              </label>
              <label>
                <span>Room length <small>(feet)</small></span>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  required
                  value={roomLength}
                  onChange={(event) => setRoomLength(event.target.value)}
                  placeholder="e.g. 44"
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Floor plan</legend>
            <label className="file-field">
              <span>Floor plan PDF <small>(optional for now)</small></span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
              />
              <span className="file-button">Choose PDF</span>
              <span className="file-name">
                {fileName || 'No file selected'}
              </span>
            </label>
            <p className="field-note">
              We’ll keep the file name for now. The PDF is not read or parsed.
            </p>
          </fieldset>

          <button className="form-submit" type="submit">
            Create starting layout <span>→</span>
          </button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const pathname = window.location.pathname;
  const isAppRoute = pathname === '/app' || pathname === '/app/';
  const isEditorRoute =
    pathname === '/app/editor' || pathname === '/app/editor/';

  if (!isAppRoute && !isEditorRoute) {
    return null;
  }

  document.body.classList.add('app-page');
  document.querySelector('.screen')?.remove();

  if (isEditorRoute) {
    return <Editor />;
  }

  return <IntakeForm />;
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
