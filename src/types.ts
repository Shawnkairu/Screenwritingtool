export interface Scene {
  number: number;
  title: string;
  summary: string;
  tension: number;
  characters: string[];
  value_shift: 'positive_to_negative' | 'negative_to_positive' | 'static';
  conflict_type: 'none' | 'internal' | 'interpersonal' | 'external';
  has_subtext: boolean;
}

export interface Character {
  name: string;
  want: string;
  need: string;
  fear: string;
  competing_desires: string;
  arc_summary: string;
  scenes_in: number[];
}

export interface Relationship {
  from: string;
  to: string;
  type: 'allied' | 'conflict' | 'tension' | 'romantic' | 'power' | 'neutral';
  intensity: number;
  label: string;
}

export interface TurningPoint {
  scene: number;
  description: string;
}

export interface PlantedDetail {
  detail: string;
  scene: number;
  payoff_scene: number | null;
}

export interface Structure {
  dramatic_question: string;
  protagonist: string;
  protagonist_want: string;
  central_conflict: string;
  act_break_scenes: number[];
  midpoint_scene: number | null;
  turning_points: TurningPoint[];
  skill_level: 'beginner' | 'intermediate' | 'advanced';
  draft_stage: 'first_draft' | 'revision' | 'polish';
  biggest_issue: string;
}

export interface Analysis {
  scenes: Scene[];
  characters: Character[];
  relationships: Relationship[];
  planted_details: PlantedDetail[];
  structure: Structure;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export type ActiveTab = 'tension' | 'characters' | 'scenes';
