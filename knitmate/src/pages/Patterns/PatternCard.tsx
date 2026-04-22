import { useEffect, useRef } from 'react';
import type { Pattern } from './types';
import { renderGridToCanvas } from './dmcMap';

interface PatternCardProps {
  pattern: Pattern;
  onClick: (p: Pattern) => void;
}

export default function PatternCard({ pattern, onClick }: PatternCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const date = new Date(pattern.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  useEffect(() => {
    if (pattern.thumbnail_url || !pattern.grid_data || !canvasRef.current) return;
    renderGridToCanvas(pattern.grid_data, canvasRef.current, 200);
  }, [pattern]);

  return (
    <div
      className="pattern-card bg-white rounded-2xl border border-gray-100 overflow-hidden cursor-pointer"
      style={{ transition: 'transform 0.2s, box-shadow 0.2s', breakInside: 'avoid', marginBottom: 20 }}
      onClick={() => onClick(pattern)}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 16px 40px -8px rgba(196,146,112,0.15)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
    >
      <div className="overflow-hidden">
        {pattern.thumbnail_url ? (
          <img
            src={pattern.thumbnail_url}
            alt={pattern.name}
            className="w-full aspect-square object-cover"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full aspect-square"
            style={{ imageRendering: 'pixelated', display: 'block' }}
          />
        )}
      </div>
      <div className="p-4">
        <h4 className="font-bold text-brand-dark text-sm leading-tight mb-1">{pattern.name}</h4>
        <p className="text-xs text-brand-gray mb-2">
          {pattern.width} × {pattern.height} sts · {pattern.color_count} colors
        </p>
        <div className="flex flex-wrap gap-1 mb-3">
          {(pattern.tags ?? []).slice(0, 3).map(t => (
            <span key={t} className="text-xs bg-gray-100 text-brand-gray px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-brand-gray">{date}</span>
          <span className="text-xs font-semibold text-brand-dark flex items-center gap-1">
            View <i className="fa-solid fa-arrow-right text-[10px]" />
          </span>
        </div>
      </div>
    </div>
  );
}
