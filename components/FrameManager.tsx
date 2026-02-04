"use client";

import { useMemo } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type FrameItem = {
  id: string;
  name: string;
  url: string;      // objectURL
  file: File;
};

function SortableRow({
  item,
  selected,
  onSelect,
  onRemove
}: {
  item: FrameItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={"thumb" + (selected ? " selected" : "")}
      onClick={() => onSelect(item.id)}
      title="點選切換；拖曳可重新排序"
    >
      <img src={item.url} alt={item.name} />
      <div className="col" style={{ gap: 4 }}>
        <div className="name">{item.name}</div>
        <div className="muted small">PNG 透明邊框</div>
      </div>

      <div className="actions">
        <button className="ghost" {...attributes} {...listeners} title="拖曳排序">↕</button>
        <button className="danger" onClick={(e) => { e.stopPropagation(); onRemove(item.id); }} title="移除">✕</button>
      </div>
    </div>
  );
}

export default function FrameManager({
  frames,
  selectedId,
  onChange,
  onSelect
}: {
  frames: FrameItem[];
  selectedId: string | null;
  onChange: (next: FrameItem[]) => void;
  onSelect: (id: string | null) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = useMemo(() => frames.map(f => f.id), [frames]);

  function onDragEnd(event: any) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = frames.findIndex(f => f.id === active.id);
    const newIndex = frames.findIndex(f => f.id === over.id);
    onChange(arrayMove(frames, oldIndex, newIndex));
  }

  return (
    <div className="col">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="muted">最多 5 個邊框（透明 PNG）</div>
        <div className="badge">{frames.length}/5</div>
      </div>

      <input
        type="file"
        accept="image/png"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;

          const left = Math.max(0, 5 - frames.length);
          const picked = files.slice(0, left);

          const next = [...frames];
          for (const f of picked) {
            const id = crypto.randomUUID();
            next.push({ id, name: f.name, url: URL.createObjectURL(f), file: f });
          }
          onChange(next);
          if (!selectedId && next[0]) onSelect(next[0].id);

          // reset so that uploading the same file again works
          e.currentTarget.value = "";
        }}
      />

      {frames.length === 0 ? (
        <div className="muted">尚未上傳邊框。你可以先做一張 2160×2880 的透明 PNG，中心挖空（alpha 透明）。</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="thumbList">
              {frames.map(item => (
                <SortableRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={(id) => onSelect(id)}
                  onRemove={(id) => {
                    const next = frames.filter(f => f.id !== id);
                    onChange(next);
                    if (selectedId === id) onSelect(next[0]?.id ?? null);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="muted small">
        提醒：邊框會在輸出畫布上自動縮放到 2160×2880（或自動降級後的尺寸），並置中對齊。
      </div>
    </div>
  );
}
