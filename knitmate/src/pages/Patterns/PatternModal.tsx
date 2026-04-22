import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Pattern } from './types';
import { renderGridToCanvas, getDMCName, DMC_MAP } from './dmcMap';

interface PatternModalProps {
  pattern: Pattern | null;
  onClose: () => void;
  showToast: (msg: string) => void;
}

export default function PatternModal({ pattern, onClose, showToast }: PatternModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!pattern || !canvasRef.current) return;
    if (pattern.grid_data) {
      renderGridToCanvas(pattern.grid_data, canvasRef.current, 500);
    }
  }, [pattern]);

  useEffect(() => {
    document.body.style.overflow = pattern ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [pattern]);

  if (!pattern) return null;

  const stitches = (pattern.width ?? 0) * (pattern.height ?? 0);

  const legend = (() => {
    if (!pattern.grid_data) return [];
    const counts: Record<string, number> = {};
    for (const row of pattern.grid_data) {
      for (const id of row) counts[id] = (counts[id] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  })();

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const a = document.createElement('a');
    a.download = `${pattern.name.replace(/\s+/g, '-').toLowerCase()}.png`;
    a.href = canvasRef.current.toDataURL('image/png');
    a.click();
    showToast('Pattern downloaded!');
  };

  const handleEdit = () => {
    showToast('Opening in design tool…');
    setTimeout(() => navigate('/design'), 800);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-0">
          <div>
            <h2 className="text-2xl font-bold text-brand-dark">{pattern.name}</h2>
            <p className="text-sm text-brand-gray mt-1">
              Created {new Date(pattern.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-brand-gray hover:bg-gray-200 transition-all flex-shrink-0 ml-4"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Canvas */}
          <div>
            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 flex items-center justify-center" style={{ minHeight: 300 }}>
              <canvas ref={canvasRef} style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {(pattern.tags ?? []).map(t => (
                <span key={t} className="text-xs bg-light text-brand-dark font-medium px-3 py-1 rounded-full">{t}</span>
              ))}
            </div>
          </div>

          {/* Legend & Actions */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-gray mb-1">Grid Size</p>
                <p className="font-bold text-brand-dark text-sm">{pattern.width} × {pattern.height}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-gray mb-1">Colors</p>
                <p className="font-bold text-brand-dark text-sm">{pattern.color_count || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-gray mb-1">Stitches</p>
                <p className="font-bold text-brand-dark text-sm">{stitches.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex-1">
              <h4 className="text-sm font-bold text-brand-dark mb-3">DMC Thread Legend</h4>
              <div className="overflow-y-auto max-h-72">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-brand-gray border-b border-gray-100">
                      <th className="pb-2">Swatch</th>
                      <th className="pb-2">DMC</th>
                      <th className="pb-2">Name</th>
                      <th className="pb-2 text-right">Sts</th>
                      <th className="pb-2 text-right">Skeins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legend.map(([id, count]) => {
                      const rgb = DMC_MAP[id] ?? [180, 180, 180];
                      return (
                        <tr key={id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 pr-2">
                            <div style={{ width: 16, height: 16, background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, border: '1px solid #e5e7eb', borderRadius: 3 }} />
                          </td>
                          <td className="py-2 pr-2 font-bold text-brand-dark">{id}</td>
                          <td className="py-2 pr-2 text-brand-darker">{getDMCName(id)}</td>
                          <td className="py-2 pr-2 text-right">{count.toLocaleString()}</td>
                          <td className="py-2 text-right font-semibold text-brand-dark">{Math.ceil(count / 150)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t border-gray-100">
              <button
                onClick={handleDownload}
                className="flex-1 bg-brand-dark text-white font-semibold py-3 rounded-xl hover:bg-brand-darker transition-all flex items-center justify-center gap-2 text-sm"
              >
                <i className="fa-solid fa-download" /> Download PNG
              </button>
              <button
                onClick={handleEdit}
                className="border border-gray-200 text-brand-dark font-semibold py-3 px-5 rounded-xl hover:border-brand-dark transition-all flex items-center gap-2 text-sm"
              >
                <i className="fa-solid fa-pen" /> Edit
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
