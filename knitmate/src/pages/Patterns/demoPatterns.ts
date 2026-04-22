import type { Pattern } from './types';

function generateDemoGrid(w: number, h: number, palette: string[]): string[][] {
  const grid: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const v = (Math.sin(x * 0.5 + y * 0.3) + Math.cos(x * 0.3 - y * 0.5)) * 0.5 + 0.5;
      row.push(palette[Math.floor(v * palette.length) % palette.length]);
    }
    grid.push(row);
  }
  return grid;
}

const d = (daysAgo: number) => new Date(Date.now() - 86400000 * daysAgo).toISOString();

export const DEMO_PATTERNS: Pattern[] = [
  { id:'d1', name:'Nordic Snowflake', width:40, height:40, color_count:4, tags:['nordic','winter','geometric'], created_at:d(2), grid_data:generateDemoGrid(40,40,['blanc','336','312','762']), thumbnail_url:null },
  { id:'d2', name:'Spring Meadow', width:30, height:30, color_count:6, tags:['floral','spring','colorful'], created_at:d(5), grid_data:generateDemoGrid(30,30,['700','702','954','321','744','blanc']), thumbnail_url:null },
  { id:'d3', name:'Geometric Diamonds', width:60, height:50, color_count:3, tags:['geometric','minimal'], created_at:d(7), grid_data:generateDemoGrid(60,50,['310','816','blanc']), thumbnail_url:null },
  { id:'d4', name:'Ocean Waves', width:80, height:60, color_count:5, tags:['ocean','blue','waves'], created_at:d(10), grid_data:generateDemoGrid(80,60,['336','334','813','827','3756']), thumbnail_url:null },
  { id:'d5', name:'Autumn Leaves', width:50, height:50, color_count:7, tags:['autumn','nature','warm'], created_at:d(14), grid_data:generateDemoGrid(50,50,['900','947','740','742','437','898','blanc']), thumbnail_url:null },
  { id:'d6', name:'Lavender Fields', width:45, height:45, color_count:4, tags:['floral','purple','soft'], created_at:d(20), grid_data:generateDemoGrid(45,45,['208','210','211','blanc']), thumbnail_url:null },
  { id:'d7', name:'Checkerboard Classic', width:20, height:20, color_count:2, tags:['minimal','classic','beginner'], created_at:d(25), grid_data:generateDemoGrid(20,20,['310','blanc']), thumbnail_url:null },
  { id:'d8', name:'Botanical Vines', width:70, height:80, color_count:8, tags:['botanical','green','detailed'], created_at:d(30), grid_data:generateDemoGrid(70,80,['700','702','703','911','954','437','801','blanc']), thumbnail_url:null },
  { id:'d9', name:'Sunrise Gradient', width:100, height:60, color_count:5, tags:['landscape','sunrise','gradient'], created_at:d(35), grid_data:generateDemoGrid(100,60,['321','900','947','744','3756']), thumbnail_url:null },
  { id:'d10', name:'Folk Art Motif', width:35, height:35, color_count:6, tags:['folk','traditional','colorful'], created_at:d(40), grid_data:generateDemoGrid(35,35,['321','700','312','744','553','blanc']), thumbnail_url:null },
  { id:'d11', name:'Minimal Lines', width:25, height:25, color_count:2, tags:['minimal','beginner','geometric'], created_at:d(45), grid_data:generateDemoGrid(25,25,['3799','762']), thumbnail_url:null },
  { id:'d12', name:'Rainbow Burst', width:55, height:55, color_count:7, tags:['rainbow','colorful','bold'], created_at:d(50), grid_data:generateDemoGrid(55,55,['321','947','744','700','334','553','blanc']), thumbnail_url:null },
];
