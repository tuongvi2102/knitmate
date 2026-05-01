import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/ui/Toast';
import PatternCard from './PatternCard';
import PatternModal from './PatternModal';
import UploadModal from './UploadModal';
import { DEMO_PATTERNS } from './demoPatterns';
import type { Pattern, SortOrder, Filters } from './types';

const PAGE_SIZE = 12;
const SUPABASE_CONFIGURED =
  import.meta.env.VITE_SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
  !!import.meta.env.VITE_SUPABASE_URL;

export default function Patterns() {
  const [allPatterns, setAllPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayedCount, setDisplayedCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({ colors: 'all', size: 'all' });
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [filterOpen, setFilterOpen] = useState(false);

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { message: toastMsg, visible: toastVisible, showToast } = useToast();

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const loadPatterns = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (SUPABASE_CONFIGURED) {
      try {
        const { data, error: err } = await supabase!
          .from('patterns')
          .select('*')
          .order('created_at', { ascending: false });
        if (err) throw err;
        setAllPatterns((data as Pattern[]) ?? []);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setError(`Database error: ${msg}. Showing demo patterns.`);
        setAllPatterns(DEMO_PATTERNS);
      }
    } else {
      setAllPatterns(DEMO_PATTERNS);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPatterns(); }, [loadPatterns]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setDebouncedQuery(val), 300);
  };

  const filteredPatterns = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    const result = allPatterns.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.tags ?? []).some(t => t.toLowerCase().includes(q))) return false;
      if (filters.colors !== 'all' && p.color_count > parseInt(filters.colors)) return false;
      const maxDim = Math.max(p.width ?? 0, p.height ?? 0);
      if (filters.size === 'small' && maxDim > 40) return false;
      if (filters.size === 'medium' && (maxDim <= 40 || maxDim >= 100)) return false;
      if (filters.size === 'large' && maxDim < 100) return false;
      return true;
    });

    result.sort((a, b) => {
      switch (sortOrder) {
        case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'colors_asc': return (a.color_count ?? 0) - (b.color_count ?? 0);
        case 'colors_desc': return (b.color_count ?? 0) - (a.color_count ?? 0);
        case 'size_asc': return ((a.width ?? 0) * (a.height ?? 0)) - ((b.width ?? 0) * (b.height ?? 0));
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return result;
  }, [allPatterns, debouncedQuery, filters, sortOrder]);

  useEffect(() => { setDisplayedCount(PAGE_SIZE); }, [filteredPatterns]);

  const displayed = filteredPatterns.slice(0, displayedCount);
  const hasMore = displayedCount < filteredPatterns.length;

  const clearFilters = () => {
    setSearchQuery(''); setDebouncedQuery('');
    setFilters({ colors: 'all', size: 'all' });
    setSortOrder('newest');
  };

  const handleUpload = (pattern: Pattern) => {
    setAllPatterns(prev => [pattern, ...prev]);
  };

  return (
    <div className="w-full min-h-screen text-warm antialiased overflow-x-hidden" style={{ background: '#FAF7F4' }}>
      <Toast message={toastMsg} visible={toastVisible} />

      {/* Hero / Search */}
      <section className="pt-28 pb-12 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <h1 className="text-4xl font-extrabold text-brand-dark mb-3">Free Pattern Gallery</h1>
            <p className="text-brand-gray">Explore community-created cross-stitch and colorwork patterns.</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 max-w-3xl mx-auto">
            <div className="relative flex-1">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-brand-gray text-sm" />
              <input
                type="text" value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search patterns by name or tag…"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-brand-dark focus:ring-1 focus:ring-brand-dark outline-none text-sm font-medium bg-white"
              />
            </div>
            <button
              onClick={() => setFilterOpen(o => !o)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-brand-dark hover:border-brand-dark transition-all bg-white"
            >
              <i className="fa-solid fa-sliders" /> Filters
            </button>
          </div>

          {filterOpen && (
            <div className="max-w-3xl mx-auto mt-4 bg-gray-50 rounded-2xl p-5 border border-gray-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-brand-gray mb-2">MAX COLORS</label>
                  <div className="flex flex-wrap gap-2">
                    {(['all', '5', '10', '20'] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setFilters(f => ({ ...f, colors: v }))}
                        className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${filters.colors === v ? 'bg-warm text-light border-warm' : 'border-gray-200 hover:border-warm'}`}
                      >
                        {v === 'all' ? 'Any' : `≤${v}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-gray mb-2">GRID SIZE</label>
                  <div className="flex flex-wrap gap-2">
                    {([['all','Any'],['small','Small (≤40)'],['medium','Medium'],['large','Large (100+)']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => setFilters(f => ({ ...f, size: v }))}
                        className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${filters.size === v ? 'bg-warm text-light border-warm' : 'border-gray-200 hover:border-warm'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-gray mb-2">SORT BY</label>
                  <select
                    value={sortOrder}
                    onChange={e => setSortOrder(e.target.value as SortOrder)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium focus:border-brand-dark outline-none bg-white"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="colors_asc">Fewest colors</option>
                    <option value="colors_desc">Most colors</option>
                    <option value="size_asc">Smallest grid</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Gallery */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-brand-gray font-medium">
            {loading ? 'Loading patterns…' : `${filteredPatterns.length} pattern${filteredPatterns.length !== 1 ? 's' : ''}`}
          </p>
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 bg-warm text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-secondary transition-all shadow-md"
          >
            <i className="fa-solid fa-plus" /> Upload Pattern
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="text-center py-6 mb-6 bg-red-50 rounded-2xl border border-red-100">
            <i className="fa-solid fa-triangle-exclamation text-red-400 text-2xl mb-2 block" />
            <p className="text-sm text-brand-gray mb-3">{error}</p>
            <button onClick={loadPatterns} className="bg-warm text-white font-semibold px-6 py-2.5 rounded-full text-sm">
              <i className="fa-solid fa-rotate mr-2" />Retry
            </button>
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div style={{ columns: 2 }} className="sm:[column-count:3] lg:[column-count:4] xl:[column-count:5] gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse mb-5">
                <div className="bg-gray-200 w-full aspect-square" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredPatterns.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-light flex items-center justify-center mx-auto mb-4">
              <i className="fa-solid fa-shapes text-warm text-3xl" />
            </div>
            <h3 className="text-lg font-bold text-brand-dark mb-2">No patterns found</h3>
            <p className="text-brand-gray text-sm mb-6">Try adjusting your search or filters.</p>
            <button onClick={clearFilters} className="border border-gray-200 text-brand-dark font-semibold px-6 py-2.5 rounded-full hover:border-brand-dark transition-all text-sm">
              Clear filters
            </button>
          </div>
        )}

        {/* Pattern grid — CSS masonry columns */}
        {!loading && filteredPatterns.length > 0 && (
          <div style={{ columns: 2, columnGap: 20 }} className="sm:![column-count:3] lg:![column-count:4] xl:![column-count:5]">
            {displayed.map(p => (
              <PatternCard key={p.id} pattern={p} onClick={setSelectedPattern} />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && !loading && (
          <div className="text-center mt-10">
            <button
              onClick={() => setDisplayedCount(c => c + PAGE_SIZE)}
              className="border-2 border-gray-200 text-brand-dark font-semibold px-10 py-3 rounded-full hover:border-brand-dark transition-all"
            >
              Load more patterns
            </button>
          </div>
        )}
      </main>

      <PatternModal pattern={selectedPattern} onClose={() => setSelectedPattern(null)} showToast={showToast} />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUpload={handleUpload} showToast={showToast} useSupabase={SUPABASE_CONFIGURED} />
    </div>
  );
}
