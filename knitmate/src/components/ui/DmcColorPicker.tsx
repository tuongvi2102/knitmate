import { useState, useMemo } from 'react';
import { DMC_WITH_LAB, type DmcColor } from '../../data/dmc';

interface DmcColorPickerProps {
  value?: DmcColor | null;
  onChange: (color: DmcColor) => void;
  label?: string;
}

export default function DmcColorPicker({ value, onChange, label }: DmcColorPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return DMC_WITH_LAB.slice(0, 60);
    return DMC_WITH_LAB.filter(c =>
      c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    ).slice(0, 60);
  }, [query]);

  return (
    <div>
      {label && <label className="block text-xs font-semibold text-brand-gray mb-1">{label}</label>}
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search DMC color…"
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-dark mb-2"
      />
      <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-lg">
        {filtered.map(c => (
          <button
            key={c.id}
            onClick={() => onChange(c)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${value?.id === c.id ? 'bg-light' : ''}`}
          >
            <span
              className="w-5 h-5 rounded-full border border-gray-200 flex-shrink-0"
              style={{ background: `rgb(${c.r},${c.g},${c.b})` }}
            />
            <span className="font-medium text-brand-dark">{c.id}</span>
            <span className="text-brand-gray truncate">{c.name}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-center text-brand-gray">No colors found</p>
        )}
      </div>
    </div>
  );
}
