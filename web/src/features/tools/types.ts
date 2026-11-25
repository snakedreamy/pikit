import type { Component } from 'svelte';
import type { IconName } from '../../icons/names';
import type { ToolCategory } from './categories';

export type { ToolCategory };

export interface ToolMeta {
  id: string;
  category: ToolCategory;
  order: number;
  icon: IconName;
  badge: string;
  load: () => Promise<{ default: Component }>;
}

export interface ToolSummary {
  id: string;
  category: ToolCategory;
  order: number;
  icon: IconName;
  badge: string;
  name: string;
  description: string;
}
