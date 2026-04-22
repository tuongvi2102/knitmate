import { useRef, useState } from 'react';
import type { Pattern } from './types';
import { nearestDMCIndex } from '../../data/dmc';
import { DMC_WITH_LAB } from '../../data/dmc';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onUpload: (pattern: Pattern) => void;
  showToast: (msg: string) => void;
  useSupabase: boolean;
}

async function imageToGrid(file: File, targetW: number, targetH: number): Promise<string[][]> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = targetW; c.height = targetH;
        c.getContext('2d')!.drawImage(img, 0, 0, targetW, targetH);
        const data = c.getContext('2d')!.getImageData(0, 0, targetW, targetH).data;
        const grid: string[][] = [];
        for (let y = 0; y < targetH; y++) {
          const row: string[] = [];
          for (let x = 0; x < targetW; x++) {
            const i = (y * targetW + x) * 4;
            const idx = nearestDMCIndex(data[i], data[i + 1], data[i + 2]);
            row.push(DMC_WITH_LAB[idx].id);
          }
          grid.push(row);
        }
        resolve(grid);
      };
      img.src = ev.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function UploadModal({ open, onClose, onUpload, showToast, useSupabase }: UploadModalProps) {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('Click to choose image');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileCache = useRef<File | null>(null);

  if (!open) return null;

  const handleClose = () => {
    setName(''); setTags(''); setPreviewUrl(null); setFileName('Click to choose image');
    fileCache.current = null;
    onClose();
  };

  const handleFile = (file: File) => {
    fileCache.current = file;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        if (!previewCanvasRef.current) return;
        const maxW = 300;
        const scale = Math.min(1, maxW / img.width);
        previewCanvasRef.current.width = img.width * scale;
        previewCanvasRef.current.height = img.height * scale;
        previewCanvasRef.current.getContext('2d')!.drawImage(img, 0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
        setPreviewUrl('set');
      };
      img.src = ev.target!.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { showToast('Please enter a pattern name.'); return; }
    setUploading(true);
    try {
      const file = fileCache.current;
      const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const gridData = file
        ? await imageToGrid(file, 50, 50)
        : Array.from({ length: 30 }, () => Array(30).fill('310'));

      const newPattern: Pattern = {
        id: 'u' + Date.now(),
        name: name.trim(),
        tags: tagList,
        width: gridData[0].length,
        height: gridData.length,
        color_count: new Set(gridData.flat()).size,
        grid_data: gridData,
        thumbnail_url: null,
        created_at: new Date().toISOString(),
      };

      if (!useSupabase) {
        showToast('Pattern added! (demo mode — not saved to database)');
      } else {
        showToast('Pattern uploaded!');
      }
      onUpload(newPattern);
      handleClose();
    } catch (err: unknown) {
      showToast('Upload failed: ' + (err instanceof Error ? err.message : 'unknown error'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-brand-dark">Upload Pattern</h2>
          <button onClick={handleClose} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-brand-gray hover:bg-gray-200">
            <i className="fa-solid fa-xmark text-sm" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-brand-gray mb-1">Pattern Name *</label>
            <input
              type="text" required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Nordic Snowflake"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium focus:border-brand-dark focus:ring-1 focus:ring-brand-dark outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-gray mb-1">Tags (comma-separated)</label>
            <input
              type="text" value={tags} onChange={e => setTags(e.target.value)}
              placeholder="e.g. geometric, winter, blue"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium focus:border-brand-dark focus:ring-1 focus:ring-brand-dark outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-gray mb-1">Pattern Image *</label>
            <label className="block border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-dark transition-colors">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <i className="fa-solid fa-cloud-arrow-up text-brand-gray text-2xl mb-2 block" />
              <p className="text-sm text-brand-dark font-medium">{fileName}</p>
              <p className="text-xs text-brand-gray mt-1">PNG recommended (grid pattern)</p>
            </label>
          </div>

          {previewUrl && (
            <div>
              <canvas ref={previewCanvasRef} className="rounded-xl border border-gray-200 max-w-full" />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleClose} className="flex-1 border border-gray-200 text-brand-dark font-semibold py-3 rounded-xl hover:bg-gray-50 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={uploading} className="flex-1 bg-brand-dark text-white font-semibold py-3 rounded-xl hover:bg-brand-darker transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {uploading
                ? <><i className="fa-solid fa-spinner fa-spin" /> Uploading…</>
                : <><i className="fa-solid fa-upload" /> Upload</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
