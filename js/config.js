export const API_BASE = '/api';

export const GAME_LABELS = {
  pokemon: 'Pokemon TCG',
  onepiece: 'One Piece TCG',
};

export const COMPANY_LABELS = {
  psa: 'PSA',
  cgc: 'CGC',
  bgs: 'BGS',
  tag: 'TAG',
};

// Working resolution used for measurement/analysis — kept modest so
// Claude vision calls stay fast and cheap while corner crops still carry
// enough detail to judge.
export const WORK_MAX_DIMENSION = 1200;
export const CORNER_CROP_FRACTION = 0.22; // each corner crop covers ~22% of width/height
