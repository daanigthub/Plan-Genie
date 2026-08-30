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
  attendees: number;
  hallName: string;
  eventName: string;
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

type ProjectRecord = {
  id: string;
  createdAt: number;
  intake: IntakeData;
  layout: StoredLayout;
};

type ProjectStore = {
  activeId: string | null;
  projects: ProjectRecord[];
};

const INTAKE_STORAGE_KEY = 'planGenie.intake';
const LAYOUT_STORAGE_KEY = 'planGenie.layout';
const PROJECTS_STORAGE_KEY = 'planGenie.projects';
const FIT_STORAGE_KEY = 'planGenie.fitToScreen';

const defaultTimelineBlocks: TimelineBlock[] = [
  { id: 'talk', label: 'Talk', startMinutes: 360, endMinutes: 395 },
  { id: 'dinner', label: 'Dinner', startMinutes: 395, endMinutes: 420 },
  { id: 'prayer', label: 'Prayer', startMinutes: 420, endMinutes: 440 },
];

function snapToGrid(value: number): number {
  return Math.round(value / 2) * 2;
}

function clampBetween(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// Grid lines every 2 ft become unreadable in a 200 ft hall, so the drawn
// spacing grows with the room while snapping stays on the 2 ft grid.
function getGridStep(roomWidth: number, roomLength: number): number {
  const longest = Math.max(roomWidth, roomLength);
  if (longest > 160) {
    return 20;
  }
  if (longest > 80) {
    return 10;
  }
  return 2;
}

// Real-world sizes so a 6 ft round table stays a 6 ft round table in any hall.
// Room-scale objects (stage, doors, zones) grow with the hall but stay within
// believable limits.
function standardObjectSize(
  kind: ObjectKind,
  roomWidth: number,
  roomLength: number,
): { width: number; height: number } {
  const sizes: Record<ObjectKind, { width: number; height: number }> = {
    'round-table': { width: 6, height: 6 },
    'rectangular-table': { width: 8, height: 4 },
    stage: {
      width: clampBetween(12, snapToGrid(roomWidth * 0.25), 48),
      height: clampBetween(4, snapToGrid(roomLength * 0.08), 16),
    },
    buffet: {
      width: clampBetween(6, snapToGrid(roomWidth * 0.12), 24),
      height: 3,
    },
    door: {
      width: 1.5,
      height: clampBetween(3, snapToGrid(roomLength * 0.06), 10),
    },
    zone: {
      width: clampBetween(8, snapToGrid(roomWidth * 0.2), 60),
      height: clampBetween(8, snapToGrid(roomLength * 0.2), 60),
    },
  };
  const size = sizes[kind];

  return {
    width: Math.max(1, Math.min(size.width, roomWidth)),
    height: Math.max(1, Math.min(size.height, roomLength)),
  };
}

function placeInRoom(value: number, size: number, roomSize: number): number {
  return clampBetween(0, snapToGrid(value), Math.max(0, roomSize - size));
}

function formatFeetInches(feet: number): string {
  const totalInches = Math.max(0, Math.round(feet * 12));
  const wholeFeet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (inches === 0) {
    return `${wholeFeet} ft`;
  }
  return `${wholeFeet} ft ${inches} in`;
}

function isTableKind(kind: ObjectKind): boolean {
  return kind === 'round-table' || kind === 'rectangular-table';
}

function eventTitle(intake: Pick<IntakeData, 'eventName'>): string {
  const name = intake.eventName?.trim();
  return name || 'Untitled event';
}

function hallTitle(intake: Pick<IntakeData, 'hallName'>): string {
  const name = intake.hallName?.trim();
  return name || 'Unnamed hall';
}

function normalizeIntake(value?: Partial<IntakeData> | null): IntakeData {
  return {
    roundTables: Number(value?.roundTables) || 0,
    rectangularTables: Number(value?.rectangularTables) || 0,
    chairs: Number(value?.chairs) || 0,
    roomWidth: Number(value?.roomWidth) || 0,
    roomLength: Number(value?.roomLength) || 0,
    attendees: Number(value?.attendees) || 0,
    hallName: typeof value?.hallName === 'string' ? value.hallName : '',
    eventName: typeof value?.eventName === 'string' ? value.eventName : '',
  };
}

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

function getObjectBlockState(
  layout: StoredLayout,
  blockId: string,
  object: LayoutObject,
): ObjectBlockState {
  return (
    layout.timeline.objectStates[blockId]?.[object.id] ?? {
      x: object.x,
      y: object.y,
      removed: false,
    }
  );
}

function applyObjectSize(
  layout: StoredLayout,
  objectId: string,
  width: number,
  height: number,
): StoredLayout {
  return {
    ...layout,
    objects: layout.objects.map((object) =>
      object.id === objectId ? { ...object, width, height } : object,
    ),
    timeline: {
      ...layout.timeline,
      objectStates: Object.fromEntries(
        layout.timeline.blocks.map((block) => {
          const blockStates = layout.timeline.objectStates[block.id] ?? {};
          const state = blockStates[objectId];
          if (!state) {
            return [block.id, blockStates];
          }
          return [
            block.id,
            {
              ...blockStates,
              [objectId]: {
                ...state,
                x: Math.max(
                  0,
                  Math.min(layout.roomWidth - width, snapToGrid(state.x)),
                ),
                y: Math.max(
                  0,
                  Math.min(layout.roomLength - height, snapToGrid(state.y)),
                ),
              },
            },
          ];
        }),
      ),
    },
  };
}

function generateStartingLayout(intake: IntakeData): StartingLayout {
  const roomWidth = Math.max(1, intake.roomWidth);
  const roomLength = Math.max(1, intake.roomLength);
  const margin = clampBetween(1, Math.min(roomWidth, roomLength) / 10, 8);
  const stage = standardObjectSize('stage', roomWidth, roomLength);
  const door = standardObjectSize('door', roomWidth, roomLength);
  const aisle = clampBetween(3, Math.min(roomWidth, roomLength) * 0.06, 12);
  const tableCount = intake.roundTables + intake.rectangularTables;
  const usableWidth = Math.max(roomWidth - margin * 2, 1);
  const usableLength = Math.max(
    roomLength - margin * 2 - stage.height - aisle,
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
      x: placeInRoom((roomWidth - stage.width) / 2, stage.width, roomWidth),
      y: placeInRoom(margin, stage.height, roomLength),
      width: stage.width,
      height: stage.height,
    },
    {
      id: 'entrance',
      kind: 'door',
      label: 'Entrance',
      x: 0,
      y: placeInRoom((roomLength - door.height) / 2, door.height, roomLength),
      width: door.width,
      height: door.height,
    },
  ];

  const tableObjects = [
    ...Array.from({ length: intake.roundTables }, (_, index) => ({
      kind: 'round-table' as const,
      label: `Round table ${index + 1}`,
    })),
    ...Array.from({ length: intake.rectangularTables }, (_, index) => ({
      kind: 'rectangular-table' as const,
      label: `Rectangular table ${index + 1}`,
    })),
  ];

  tableObjects.forEach((table, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const { width, height } = standardObjectSize(
      table.kind,
      usableWidth,
      usableLength,
    );

    objects.push({
      id: `${table.kind}-${index + 1}`,
      kind: table.kind,
      label: table.label,
      x: placeInRoom(
        margin + column * cellWidth + (cellWidth - width) / 2,
        width,
        roomWidth,
      ),
      y: placeInRoom(
        margin + stage.height + aisle + row * cellHeight + (cellHeight - height) / 2,
        height,
        roomLength,
      ),
      width,
      height,
    });
  });

  return { ...normalizeIntake(intake), objects };
}

function getSavedIntake(): IntakeData | null {
  try {
    const saved = sessionStorage.getItem(INTAKE_STORAGE_KEY);
    return saved
      ? normalizeIntake(JSON.parse(saved) as Partial<IntakeData>)
      : null;
  } catch {
    return null;
  }
}

function getSavedLayout(): StoredLayout | null {
  try {
    const saved = sessionStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!saved) {
      return null;
    }
    const parsed = JSON.parse(saved) as StartingLayout & {
      timeline?: TimelineState;
    };
    return withTimeline({ ...parsed, ...normalizeIntake(parsed) });
  } catch {
    return null;
  }
}

function saveActiveProjectKeys(intake: IntakeData, layout: StoredLayout) {
  sessionStorage.setItem(INTAKE_STORAGE_KEY, JSON.stringify(intake));
  sessionStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function writeProjectStore(store: ProjectStore) {
  sessionStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(store));
}

function readProjectStore(): ProjectStore | null {
  try {
    const saved = sessionStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!saved) {
      return null;
    }
    const parsed = JSON.parse(saved) as ProjectStore;
    if (!parsed || !Array.isArray(parsed.projects)) {
      return null;
    }
    return {
      activeId: parsed.activeId ?? null,
      projects: parsed.projects.map((project) => {
        const intake = normalizeIntake(project.intake ?? project.layout);
        return {
          ...project,
          intake,
          layout: withTimeline({ ...project.layout, ...intake }),
        };
      }),
    };
  } catch {
    return null;
  }
}

function migrateLegacyProject(): ProjectStore {
  const layout = getSavedLayout();
  if (!layout) {
    return { activeId: null, projects: [] };
  }
  const intake = normalizeIntake(getSavedIntake() ?? layout);
  const project: ProjectRecord = {
    id: `project-${Date.now()}`,
    createdAt: Date.now(),
    intake,
    layout: withTimeline({ ...layout, ...intake }),
  };
  const store = { activeId: project.id, projects: [project] };
  writeProjectStore(store);
  saveActiveProjectKeys(intake, project.layout);
  return store;
}

function getProjectStore(): ProjectStore {
  return readProjectStore() ?? migrateLegacyProject();
}

function persistActiveLayout(layout: StoredLayout) {
  const intake = normalizeIntake(layout);
  saveActiveProjectKeys(intake, layout);

  let store: ProjectStore = { activeId: null, projects: [] };
  try {
    const saved = sessionStorage.getItem(PROJECTS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ProjectStore;
      if (parsed && Array.isArray(parsed.projects)) {
        store = parsed;
      }
    }
  } catch {
    store = { activeId: null, projects: [] };
  }

  const activeId =
    store.activeId ?? store.projects[0]?.id ?? `project-${Date.now()}`;
  const existing = store.projects.find((project) => project.id === activeId);
  const project: ProjectRecord = existing
    ? { ...existing, intake, layout }
    : {
        id: activeId,
        createdAt: Date.now(),
        intake,
        layout,
      };
  const projects = existing
    ? store.projects.map((item) => (item.id === activeId ? project : item))
    : [...store.projects, project];
  writeProjectStore({ activeId, projects });
}

function createProjectFromIntake(intake: IntakeData): ProjectRecord {
  const layout = withTimeline(generateStartingLayout(intake));
  const project: ProjectRecord = {
    id: `project-${Date.now()}`,
    createdAt: Date.now(),
    intake,
    layout,
  };
  const store = getProjectStore();
  writeProjectStore({
    activeId: project.id,
    projects: [...store.projects, project],
  });
  saveActiveProjectKeys(intake, layout);
  return project;
}

function switchToProject(id: string): ProjectRecord | null {
  const store = getProjectStore();
  const project = store.projects.find((item) => item.id === id);
  if (!project) {
    return null;
  }
  writeProjectStore({ ...store, activeId: id });
  saveActiveProjectKeys(project.intake, project.layout);
  return project;
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
  const labels: Record<ObjectKind, string> = {
    'round-table': 'Round table',
    'rectangular-table': 'Rectangular table',
    stage: 'Stage',
    buffet: 'Buffet station',
    door: 'Entrance / exit',
    zone: 'New zone',
  };
  const { width, height } = standardObjectSize(kind, roomWidth, roomLength);

  return {
    id: `${kind}-${Date.now()}-${objectNumber}`,
    kind,
    label: labels[kind],
    x: placeInRoom((roomWidth - width) / 2, width, roomWidth),
    y: placeInRoom((roomLength - height) / 2, height, roomLength),
    width,
    height,
  };
}

function Editor() {
  const [layout, setLayout] = useState<StoredLayout | null>(() => {
    const store = getProjectStore();
    return (
      store.projects.find((project) => project.id === store.activeId)
        ?.layout ?? getSavedLayout()
    );
  });
  const [projects, setProjects] = useState(
    () => getProjectStore().projects,
  );
  const [activeProjectId, setActiveProjectId] = useState(
    () => getProjectStore().activeId,
  );
  const [dragging, setDragging] = useState<{
    id: string;
    blockId: string;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const [resizing, setResizing] = useState<{
    id: string;
    originX: number;
    originY: number;
    startWidth: number;
    startHeight: number;
    startPointerX: number;
    startPointerY: number;
    lockAspect: boolean;
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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    null,
  );
  const [fitToScreen, setFitToScreen] = useState(
    () => sessionStorage.getItem(FIT_STORAGE_KEY) !== '0',
  );

  useEffect(() => {
    if (layout) {
      persistActiveLayout(layout);
    }
  }, [layout]);

  useEffect(() => {
    sessionStorage.setItem(FIT_STORAGE_KEY, fitToScreen ? '1' : '0');
  }, [fitToScreen]);

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
      const nextX = Math.max(
        0,
        Math.min(
          activeLayout.roomWidth - activeDrag.width,
          snapToGrid(pointerX - activeDrag.offsetX),
        ),
      );
      const nextY = Math.max(
        0,
        Math.min(
          activeLayout.roomLength - activeDrag.height,
          snapToGrid(pointerY - activeDrag.offsetY),
        ),
      );

      setLayout((current) =>
        current
          ? {
              ...current,
              timeline: {
                ...current.timeline,
                objectStates: {
                  ...current.timeline.objectStates,
                  [activeDrag.blockId]: {
                    ...current.timeline.objectStates[activeDrag.blockId],
                    [activeDrag.id]: {
                      ...current.timeline.objectStates[activeDrag.blockId][
                        activeDrag.id
                      ],
                      x: nextX,
                      y: nextY,
                    },
                  },
                },
              },
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
    if (!resizing || !layout) {
      return;
    }
    const session = resizing;
    const roomWidth = layout.roomWidth;
    const roomLength = layout.roomLength;

    function handlePointerMove(event: PointerEvent) {
      const room = roomRef.current;
      if (!room) {
        return;
      }

      const bounds = room.getBoundingClientRect();
      const pointerX =
        ((event.clientX - bounds.left) / bounds.width) * roomWidth;
      const pointerY =
        ((event.clientY - bounds.top) / bounds.height) * roomLength;
      const rawWidth = session.startWidth + (pointerX - session.startPointerX);
      const rawHeight = session.startHeight + (pointerY - session.startPointerY);
      let nextWidth = rawWidth;
      let nextHeight = rawHeight;

      if (session.lockAspect) {
        const dominant =
          Math.abs(pointerX - session.startPointerX) >=
          Math.abs(pointerY - session.startPointerY)
            ? rawWidth
            : rawHeight;
        nextWidth = dominant;
        nextHeight = dominant;
      }

      nextWidth = Math.max(2, snapToGrid(nextWidth));
      nextHeight = Math.max(2, snapToGrid(nextHeight));
      nextWidth = Math.max(2, Math.min(nextWidth, roomWidth - session.originX));
      nextHeight = Math.max(
        2,
        Math.min(nextHeight, roomLength - session.originY),
      );

      if (session.lockAspect) {
        const size = Math.min(nextWidth, nextHeight);
        nextWidth = size;
        nextHeight = size;
      }

      setLayout((current) =>
        current ? applyObjectSize(current, session.id, nextWidth, nextHeight) : current,
      );
    }

    function handlePointerUp() {
      setResizing(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizing, layout?.roomWidth, layout?.roomLength]);

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

  const activeLayout = layout;

  function addObject(kind: ObjectKind) {
    const object = newObject(
      kind,
      activeLayout.roomWidth,
      activeLayout.roomLength,
      activeLayout.objects.length + 1,
    );

    setLayout((current) => {
      if (!current) {
        return current;
      }

      const objectStates = Object.fromEntries(
        current.timeline.blocks.map((block) => [
          block.id,
          {
            ...current.timeline.objectStates[block.id],
            [object.id]: {
              x: object.x,
              y: object.y,
              removed: false,
            },
          },
        ]),
      );

      return {
        ...current,
        objects: [...current.objects, object],
        timeline: {
          ...current.timeline,
          objectStates,
        },
      };
    });
    setSelectedObjectId(object.id);
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    object: LayoutObject,
  ) {
    if (
      event.button !== 0 ||
      !roomRef.current ||
      !layout ||
      isPlaying ||
      isScrubbing ||
      resizing
    ) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('.object-remove, .object-resize')) {
      return;
    }

    const objectState = getObjectBlockState(
      activeLayout,
      currentBlock.id,
      object,
    );
    if (objectState.removed) {
      setSelectedObjectId(object.id);
      return;
    }

    const bounds = roomRef.current.getBoundingClientRect();
    const roomWidth = activeLayout.roomWidth;
    const roomLength = activeLayout.roomLength;
    const pointerX =
      ((event.clientX - bounds.left) / bounds.width) * roomWidth;
    const pointerY =
      ((event.clientY - bounds.top) / bounds.height) * roomLength;

    event.preventDefault();
    setSelectedObjectId(object.id);
    setDragging({
      id: object.id,
      blockId: currentBlock.id,
      offsetX: pointerX - objectState.x,
      offsetY: pointerY - objectState.y,
      width: object.width,
      height: object.height,
    });
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLSpanElement>,
    object: LayoutObject,
  ) {
    if (
      event.button !== 0 ||
      !roomRef.current ||
      isPlaying ||
      isScrubbing
    ) {
      return;
    }

    const objectState = getObjectBlockState(
      activeLayout,
      currentBlock.id,
      object,
    );
    if (objectState.removed) {
      return;
    }

    const bounds = roomRef.current.getBoundingClientRect();
    const pointerX =
      ((event.clientX - bounds.left) / bounds.width) * activeLayout.roomWidth;
    const pointerY =
      ((event.clientY - bounds.top) / bounds.height) * activeLayout.roomLength;

    event.preventDefault();
    event.stopPropagation();
    setSelectedObjectId(object.id);
    setDragging(null);
    setResizing({
      id: object.id,
      originX: objectState.x,
      originY: objectState.y,
      startWidth: object.width,
      startHeight: object.height,
      startPointerX: pointerX,
      startPointerY: pointerY,
      lockAspect: object.kind === 'round-table',
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
  const removedInBlock = layout.objects.filter((object) =>
    getObjectBlockState(layout, currentBlock.id, object).removed,
  );
  const gridStep = getGridStep(layout.roomWidth, layout.roomLength);

  function toggleObjectRemoval(object: LayoutObject) {
    const currentState = getObjectBlockState(
      activeLayout,
      currentBlock.id,
      object,
    );
    setLayout((current) =>
      current
        ? {
            ...current,
            timeline: {
              ...current.timeline,
              objectStates: {
                ...current.timeline.objectStates,
                [currentBlock.id]: {
                  ...current.timeline.objectStates[currentBlock.id],
                  [object.id]: {
                    ...currentState,
                    removed: !currentState.removed,
                  },
                },
              },
            },
          }
        : current,
    );
    setSelectedObjectId(object.id);
  }

  function handleProjectSwitch(id: string) {
    if (layout) {
      persistActiveLayout(layout);
    }
    const project = switchToProject(id);
    if (!project) {
      return;
    }
    setActiveProjectId(project.id);
    setLayout(project.layout);
    setProjects(getProjectStore().projects);
    setSelectedObjectId(null);
    setDragging(null);
    setResizing(null);
  }

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
    setDragging(null);
    setResizing(null);
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
          <strong>{eventTitle(layout)}</strong>
          <span>
            {hallTitle(layout)}
            {layout.attendees > 0 ? ` · ${layout.attendees} attending` : ''}
          </span>
        </div>
      </header>

      <div className="editor-body">
        <aside className="editor-sidebar" aria-label="Add objects">
          <div>
            <p className="sidebar-kicker">Editor</p>
            <h1>Build your room.</h1>
            <p className="sidebar-copy">
              Drag anything on the plan to move it. Objects align to a 2 ft
              grid. Use a table’s corner to resize it.
            </p>
          </div>

          {projects.length > 1 ? (
            <label className="editor-project-switch">
              <span>Project</span>
              <select
                value={activeProjectId ?? ''}
                onChange={(event) => handleProjectSwitch(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {eventTitle(project.intake)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

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

          {removedInBlock.length > 0 ? (
            <div className="selected-object-panel" aria-live="polite">
              <p className="tool-list-heading">Removed in this block</p>
              {removedInBlock.map((object) => (
                <button
                  className="selected-object-action"
                  key={object.id}
                  type="button"
                  onClick={() => toggleObjectRemoval(object)}
                >
                  Bring back {object.label}
                </button>
              ))}
            </div>
          ) : null}

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
              <h2 id="plan-title">{hallTitle(layout)}</h2>
              <p className="workspace-event">{eventTitle(layout)}</p>
            </div>
            <div className="workspace-scale">
              <span className="scale-line" aria-hidden="true" />
              <span>
                {layout.roomWidth} × {layout.roomLength} ft ·{' '}
                {gridStep === 2
                  ? '2 ft grid'
                  : `${gridStep} ft grid, snaps to 2 ft`}
              </span>
              <button
                className={`fit-toggle${fitToScreen ? ' is-active' : ''}`}
                type="button"
                aria-pressed={fitToScreen}
                onClick={() => setFitToScreen((current) => !current)}
              >
                Fit to screen
              </button>
            </div>
          </div>

          <div
            className={`room-editor${fitToScreen ? ' is-fit' : ''}`}
            ref={roomRef}
            style={
              {
                aspectRatio: `${layout.roomWidth} / ${layout.roomLength}`,
                '--room-ratio': `${layout.roomWidth / layout.roomLength}`,
                '--grid-width': `${(gridStep / layout.roomWidth) * 100}%`,
                '--grid-height': `${(gridStep / layout.roomLength) * 100}%`,
              } as CSSProperties
            }
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedObjectId(null);
              }
            }}
          >
            <span className="room-dimension room-dimension-width">
              {layout.roomWidth} ft
            </span>
            <span className="room-dimension room-dimension-length">
              {layout.roomLength} ft
            </span>
            {layout.objects.map((object) => {
              const objectState = getObjectBlockState(
                layout,
                currentBlock.id,
                object,
              );
              const isCompact =
                object.width / layout.roomWidth < 0.07 ||
                object.height / layout.roomLength < 0.07;

              return (
                <div
                  className={`editor-object editor-${object.kind}${
                    dragging?.id === object.id ? ' is-dragging' : ''
                  }${
                    resizing?.id === object.id ? ' is-resizing' : ''
                  }${
                    selectedObjectId === object.id ? ' is-selected' : ''
                  }${isCompact ? ' is-compact' : ''}${
                    objectState.removed ? ' is-removed' : ''
                  }`}
                  key={object.id}
                  role="group"
                  tabIndex={objectState.removed ? -1 : 0}
                  title={`${object.label} · ${
                    objectState.removed
                      ? 'removed from this block'
                      : `${formatFeetInches(object.width)} × ${formatFeetInches(object.height)}`
                  }`}
                  aria-label={`${object.label}, ${
                    objectState.removed
                      ? 'removed from this block'
                      : `${formatFeetInches(object.width)} by ${formatFeetInches(object.height)}`
                  }`}
                  aria-hidden={false}
                  onPointerDown={(event) => handlePointerDown(event, object)}
                  style={{
                    left: `${(objectState.x / layout.roomWidth) * 100}%`,
                    top: `${(objectState.y / layout.roomLength) * 100}%`,
                    width: `${(object.width / layout.roomWidth) * 100}%`,
                    height: `${(object.height / layout.roomLength) * 100}%`,
                  }}
                >
                  <span className="object-label">{object.label}</span>
                  {selectedObjectId === object.id &&
                  isTableKind(object.kind) &&
                  !objectState.removed ? (
                    <span className="object-size">
                      {formatFeetInches(object.width)} ×{' '}
                      {formatFeetInches(object.height)}
                    </span>
                  ) : null}
                  {selectedObjectId === object.id && !objectState.removed ? (
                    <button
                      className="object-remove"
                      type="button"
                      aria-label={`Remove ${object.label} from this block`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleObjectRemoval(object);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                  {selectedObjectId === object.id &&
                  isTableKind(object.kind) &&
                  !objectState.removed ? (
                    <span
                      className="object-resize"
                      role="slider"
                      tabIndex={0}
                      aria-label={`Resize ${object.label}`}
                      aria-valuemin={2}
                      aria-valuemax={Math.min(
                        layout.roomWidth,
                        layout.roomLength,
                      )}
                      aria-valuenow={Math.round(object.width)}
                      aria-valuetext={`${formatFeetInches(object.width)} by ${formatFeetInches(object.height)}`}
                      onPointerDown={(event) =>
                        handleResizePointerDown(event, object)
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="workspace-note">
            Drag objects to position them. Click a table to see its size,
            resize from the corner, or remove it from this time block.
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
  const [eventName, setEventName] = useState('');
  const [hallName, setHallName] = useState('');
  const [attendees, setAttendees] = useState('');
  const [roundTables, setRoundTables] = useState('');
  const [rectangularTables, setRectangularTables] = useState('');
  const [chairs, setChairs] = useState('');
  const [roomWidth, setRoomWidth] = useState('');
  const [roomLength, setRoomLength] = useState('');
  const [fileName, setFileName] = useState('');
  const [projects] = useState(() => getProjectStore().projects);
  const [activeProjectId] = useState(() => getProjectStore().activeId);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFileName(event.target.files?.[0]?.name ?? '');
  }

  function openProject(id: string) {
    if (!switchToProject(id)) {
      return;
    }
    window.location.assign('/app/editor');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const intake: IntakeData = {
      roundTables: Number(roundTables),
      rectangularTables: Number(rectangularTables),
      chairs: Number(chairs),
      roomWidth: Number(roomWidth),
      roomLength: Number(roomLength),
      attendees: Number(attendees),
      hallName: hallName.trim(),
      eventName: eventName.trim(),
    };

    createProjectFromIntake(intake);
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

      {projects.length > 0 ? (
        <section className="saved-projects" aria-labelledby="saved-projects-title">
          <div className="saved-projects-heading">
            <p className="eyebrow">Your projects</p>
            <h2 id="saved-projects-title">Open an existing event</h2>
          </div>
          <ul className="saved-projects-list">
            {projects.map((project) => (
              <li key={project.id}>
                <div>
                  <strong>{eventTitle(project.intake)}</strong>
                  <span>
                    {hallTitle(project.intake)}
                    {project.intake.attendees > 0
                      ? ` · ${project.intake.attendees} people`
                      : ''}
                  </span>
                </div>
                <button
                  className="saved-project-open"
                  type="button"
                  onClick={() => openProject(project.id)}
                >
                  {project.id === activeProjectId ? 'Continue' : 'Open'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="intake-card" aria-labelledby="intake-title">
        <p className="eyebrow">Let’s set up your room</p>
        <h1 id="intake-title">Tell us what you’re working with.</h1>
        <p className="intake-intro">
          Name the event, add the basics, and Plan Genie will give you a
          starting layout to adjust. Submitting this form creates a new
          project.
        </p>

        <form onSubmit={handleSubmit}>
          <fieldset>
            <legend>Event</legend>
            <div className="field-grid">
              <label>
                <span>Event name</span>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={eventName}
                  onChange={(event) => setEventName(event.target.value)}
                  placeholder="e.g. Pickle Hackathon"
                />
              </label>
              <label>
                <span>Hall name</span>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={hallName}
                  onChange={(event) => setHallName(event.target.value)}
                  placeholder="e.g. Oak Denny Hall"
                />
              </label>
              <label>
                <span>People attending</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={attendees}
                  onChange={(event) => setAttendees(event.target.value)}
                  placeholder="e.g. 80"
                />
              </label>
            </div>
          </fieldset>

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
