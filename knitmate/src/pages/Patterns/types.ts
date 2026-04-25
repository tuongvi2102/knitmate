export interface Pattern {
  id: string;
  name: string;
  width: number;
  height: number;
  color_count: number;
  tags: string[];
  grid_data: string[][] | null;
  thumbnail_url: string | null;
  created_at: string;
  _thumbData?: string;
}

export type SortOrder = 'newest' | 'oldest' | 'colors_asc' | 'colors_desc' | 'size_asc';

export interface Filters {
  colors: 'all' | '5' | '10' | '20';
  size: 'all' | 'small' | 'medium' | 'large';
}
