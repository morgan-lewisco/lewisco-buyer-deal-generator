import { BuyerProfile } from './types';

// Buyer managers who can be assigned leads
export const BUYER_NAMES = ['Dewey Yeager', 'Igor Vega', 'Edward Rivers', 'Donny Carter', 'Jesse Kroll', 'Alex Chaney', 'Evan Jaslow', 'Jeff'];

// Single global profile — covers all of Lewisco's categories and signals
export const GLOBAL_PROFILE: BuyerProfile = {
  id: 'global',
  name: 'Lewisco Holdings',
  bio: 'Full-spectrum closeout buyer: frozen, refrigerated, dry grocery, beverages, snacks, candy, pet food, health & beauty, household products.',
  badge: { label: 'Global Pool', color: 'slate', emoji: '🌐' },
  zohoOwnerName: '',
  lanes: [
    'branded CPG food & beverage closeouts',
    'frozen & refrigerated food surplus',
    'dry grocery & shelf-stable overstock',
    'beverages — juice, functional soda, water, coffee, energy',
    'snacks, popcorn, candy, cookies & confectionery',
    'canned & shelf-stable grocery',
    'sports nutrition & supplements',
    'Hispanic / international / specialty imports',
    'sweeteners, baking & dairy',
    'condiments, sauces & pantry',
    'pet food & pet supplies',
    'health & beauty / personal care',
    'household cleaning & paper products',
    'Mediterranean / specialty pantry imports',
  ],
  categories: [
    'Beverages', 'Snacks', 'Candy', 'Canned Seafood', 'Pantry',
    'Canned Grocery', 'Dairy', 'Condiments', 'International Foods',
    'Sports Nutrition', 'Pet Food', 'Health & Beauty', 'Household',
    'Frozen Foods', 'Refrigerated Foods',
  ],
  seedVendors: [
    'UTZ Quality Foods', 'Lassonde Pappas', 'World Finer Foods', 'Olipop',
    'Medallion Foods', 'Zevia', 'Nutrabolt', 'Heartland', 'Liquid Death',
    'Vilore Foods', 'Primal Kitchen', 'HP Hood', 'Fremont Company',
    'Poppi', 'Talking Rain', 'Wild Planet', 'StarKist', 'Lotus Bakeries',
    'Danone', 'Feastables', 'Roar Organic', 'Ziyad', 'Vigo',
    'Keystone Food Products', 'Pearson Candy', 'Kellogg',
  ],
  revenueBand: { min: 5_000_000, max: 2_000_000_000 },
  geographies: ['US'],
  signalEvents: [
    { type: 'merger_acquisition',  weight: 0.9 },
    { type: 'divestiture',         weight: 0.95 },
    { type: 'plant_closure',       weight: 1.0 },
    { type: 'layoffs',             weight: 0.85 },
    { type: 'facility_relocation', weight: 0.8 },
  ],
  scoringWeights: { fit: 0.45, signal: 0.55 },
};

export const DEFAULT_BUYERS: BuyerProfile[] = [
  {
    id: 'dewey',
    name: 'Dewey',
    bio: 'Company top earner, focused on branded food and beverage closeouts. Natural drinks, snacks, candy, canned seafood, and Mediterranean pantry imports.',
    badge: { label: 'Top Earner', color: 'amber', emoji: '⭐' },
    zohoOwnerName: 'Dewey Yeager',
    lanes: [
      'branded CPG food & beverage',
      'functional & natural beverages',
      'snacks & candy',
      'canned seafood',
      'Mediterranean/pantry imports',
    ],
    categories: ['Beverages', 'Snacks', 'Candy', 'Canned Seafood', 'Pantry', 'Pet Food'],
    seedVendors: [
      'Poppi', 'Talking Rain', 'Wild Planet', 'StarKist', 'Lotus Bakeries',
      'Danone', 'Feastables', 'Roar Organic', 'Ziyad', 'Vigo', 'Star Fine Foods',
    ],
    revenueBand: { min: 5_000_000, max: 750_000_000 },
    geographies: ['US'],
    signalEvents: [
      { type: 'merger_acquisition', weight: 0.9 },
      { type: 'divestiture', weight: 0.95 },
      { type: 'plant_closure', weight: 1.0 },
      { type: 'layoffs', weight: 0.85 },
      { type: 'facility_relocation', weight: 0.8 },
    ],
    scoringWeights: { fit: 0.45, signal: 0.55 },
  },

  // ── Igor ──────────────────────────────────────────────────────────────────
  // Broad opportunistic closeout buyer. Signal stream weighted higher than Dewey.
  // Restoration Wireless excluded from seeds — non-food closeout trader.
  {
    id: 'igor',
    name: 'Igor',
    bio: 'High-volume opportunistic buyer spanning beverages, snacks, sports nutrition, canned grocery, and specialty imports. Broadest lane coverage on the team.',
    badge: { label: 'All-In Buyer', color: 'blue', emoji: '🌊' },
    zohoOwnerName: 'Igor Vega',
    lanes: [
      'beverages (juice, functional soda, water, coffee, energy)',
      'salty snacks, popcorn, candy & cookies',
      'sports nutrition & supplements',
      'canned & shelf-stable grocery',
      'Hispanic / international / specialty imports',
      'sweeteners, baking & dairy',
      'better-for-you condiments & pantry',
    ],
    categories: [
      'Beverages', 'Snacks', 'Candy', 'Sports Nutrition',
      'Canned Grocery', 'Dairy', 'Condiments', 'Pantry', 'International Foods',
    ],
    seedVendors: [
      'UTZ Quality Foods',    // anchor — 355 deals
      'Lassonde Pappas',      // juice & drinks
      'World Finer Foods',    // pasta / specialty imports
      'Olipop',               // functional soda
      'Medallion Foods',      // tortilla / snack chips
      'Zevia',                // zero-sugar soda
      'Nutrabolt',            // sports nutrition / C4 energy
      'Heartland',            // sweeteners / Splenda
      'Liquid Death',         // water
      'Vilore Foods',         // Hispanic foods & beverages / Klass
      'Fat and Weird Cookie', // cookies / snacks
      'Primal Kitchen',       // better-for-you condiments
      'HP Hood',              // dairy
      'Fremont Company',      // canned tomatoes / kraut
    ],
    revenueBand: { min: 5_000_000, max: 2_000_000_000 },
    geographies: ['US'],
    signalEvents: [
      { type: 'merger_acquisition', weight: 0.9 },
      { type: 'divestiture', weight: 0.95 },
      { type: 'plant_closure', weight: 1.0 },
      { type: 'layoffs', weight: 0.85 },
      { type: 'facility_relocation', weight: 0.8 },
    ],
    scoringWeights: { fit: 0.45, signal: 0.55 },
  },
];
