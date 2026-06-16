// Static game data: factions, units, buildings, upgrades, resources.
// Lore is carried in names/descriptions, kept terse on purpose.

export const RESOURCES = ['grain', 'timber', 'bronze', 'favor', 'knowledge'];

export const RESOURCE_INFO = {
  grain:     { name: 'Grain',               icon: '🌾', color: '#d8b75a' },
  timber:    { name: 'Timber',              icon: '🪵', color: '#a07a4f' },
  bronze:    { name: 'Bronze',              icon: '⚒️', color: '#c98a4b' },
  favor:     { name: 'Divine Favor',        icon: '✦',  color: '#ffd966' },
  knowledge: { name: 'Forbidden Knowledge', icon: '𓂀', color: '#b07fff' },
};

// Damage bonus tags: light, heavy, massive, mounted, beast, structure, corrupt, worker
// armor: flat reduction. hp/dmg tuned for ~3-8s kills between equals.

const U = (o) => Object.assign({
  supply: 1, armor: 0, tags: [], speed: 7, sight: 14, radius: 0.55,
  aggroRange: 11,
}, o);

const B = (o) => Object.assign({
  size: 3, supplyProvided: 0, trains: [], upgrades: [], dropoff: false,
  favorRate: 0, sight: 12, tags: ['structure'],
}, o);

export const FACTIONS = {
  covenant: {
    key: 'covenant',
    name: 'The Covenant Cities',
    color: 0xe8b33a, colorCss: '#e8b33a',
    glow: 0xffd56e,
    accent: 0x2f6f9f, glow2: 0xffd56e,   // Temple Blue cloth/banners; sacred-gold light
    desc: 'Priest-king city-states of the river valleys. Bronze, grain, and the favor of heaven hold their walls against the coming dark.',
    worker: 'laborer',
    main: 'city_center',
    units: {
      laborer: U({
        name: 'Laborer', worker: true, cost: { grain: 50 }, hp: 40, buildTime: 9,
        attack: { dmg: 4, range: 1.2, cooldown: 1.2 },
        speed: 6.5, model: 'worker', tags: ['light', 'worker'],
        desc: 'Tends the fields and raises the walls of the faithful.',
        trainedAt: 'city_center',
      }),
      spearman: U({
        name: 'Bronze Spearman', cost: { grain: 50, bronze: 25 }, hp: 110, buildTime: 11,
        attack: { dmg: 11, range: 1.6, cooldown: 1.1, bonus: { mounted: 2.0, beast: 2.0 } },
        armor: 1, speed: 7, model: 'spearman', tags: ['heavy'],
        desc: 'Phalanx of the city levy. Spears against chariot and beast.',
        trainedAt: 'barracks',
      }),
      archer: U({
        name: 'Sling Archer', cost: { grain: 40, timber: 30 }, hp: 60, buildTime: 10,
        attack: { dmg: 9, range: 11, cooldown: 1.4, projectile: 'stone', bonus: { massive: 1.5, heavy: 1.3 } },
        speed: 7, model: 'archer', tags: ['light'],
        desc: 'Slingers of the outer villages. Stones fell the slow and the great.',
        trainedAt: 'barracks',
      }),
      chariot: U({
        name: 'War Chariot', cost: { grain: 80, bronze: 70, timber: 30 }, hp: 150, buildTime: 16,
        attack: { dmg: 16, range: 1.8, cooldown: 1.0, bonus: { light: 1.8, worker: 1.5 } },
        armor: 1, speed: 11, supply: 2, model: 'chariot', tags: ['mounted'], radius: 0.8,
        desc: 'Bronze-shod wheels of the king. Runs down the light of foot.',
        trainedAt: 'foundry',
      }),
      temple_guard: U({
        name: 'Temple Guard', cost: { grain: 80, bronze: 60, favor: 20 }, hp: 200, buildTime: 16,
        attack: { dmg: 16, range: 1.7, cooldown: 1.1, bonus: { corrupt: 1.8 } },
        armor: 3, speed: 6.5, supply: 2, model: 'guard', tags: ['heavy'],
        desc: 'Sworn wardens of the inner sanctuary. Anathema to corrupted flesh.',
        trainedAt: 'temple',
      }),
      prophet: U({
        name: 'Prophet', cost: { grain: 100, favor: 60 }, hp: 80, buildTime: 20,
        attack: { dmg: 26, range: 10, cooldown: 3.2, projectile: 'holyfire', aoe: 3.2 },
        speed: 6.5, supply: 2, model: 'prophet', tags: ['light', 'divine'], sight: 17,
        desc: 'Speaks the burning word. Fire from heaven scatters the gathered host.',
        trainedAt: 'temple',
      }),
    },
    buildings: {
      city_center: B({
        name: 'City Center', cost: { grain: 250, timber: 150 }, hp: 1300, buildTime: 50,
        size: 4, supplyProvided: 10, trains: ['laborer'], dropoff: true, favorRate: 2,
        model: 'city_center', main: true, sight: 16,
        desc: 'Seat of the priest-king. If it falls, the covenant is broken.',
      }),
      granary: B({
        name: 'Granary', cost: { grain: 60, timber: 60 }, hp: 400, buildTime: 14,
        size: 2, supplyProvided: 10, dropoff: true, model: 'granary',
        desc: 'Stores the harvest against famine and siege. Houses the people.',
      }),
      barracks: B({
        name: 'Barracks', cost: { grain: 80, timber: 100 }, hp: 600, buildTime: 20,
        size: 3, trains: ['spearman', 'archer'], model: 'barracks',
        desc: 'Levy hall of the city. Spear and sling are mustered here.',
      }),
      foundry: B({
        name: 'Bronze Foundry', cost: { grain: 80, timber: 80, bronze: 40 }, hp: 550, buildTime: 24,
        size: 3, trains: ['chariot'], upgrades: ['cov_weapons', 'cov_armor'],
        requires: 'barracks', model: 'foundry',
        desc: 'Furnaces of tin and copper. Arms the host and builds the chariots of war.',
      }),
      temple: B({
        name: 'Temple', cost: { grain: 120, timber: 100, bronze: 60 }, hp: 700, buildTime: 30,
        size: 3, trains: ['temple_guard', 'prophet'], favorRate: 8,
        upgrades: ['cov_zeal'], requires: 'barracks', model: 'temple',
        desc: 'High place of offering. Favor descends upon the faithful city.',
      }),
      watchtower: B({
        name: 'Watchtower', cost: { timber: 80, bronze: 30 }, hp: 380, buildTime: 16,
        size: 2, attack: { dmg: 13, range: 13, cooldown: 1.5, projectile: 'stone' },
        model: 'tower', sight: 18,
        desc: 'Eyes upon the wilderness. Slingers man the heights.',
      }),
    },
  },

  watchers: {
    key: 'watchers',
    name: 'The Watcher Remnant',
    color: 0x9a5cff, colorCss: '#9a5cff',
    glow: 0xc08bff,
    accent: 0xb8b4c9, glow2: 0xd14cff,   // Star-Metal Silver armor; Sigil Magenta arcana
    desc: 'Fallen sons of heaven and their bound disciples. Star-metal, forbidden writing, and flesh remade in obsidian halls.',
    worker: 'servitor',
    main: 'fallen_spire',
    units: {
      servitor: U({
        name: 'Bound Servitor', worker: true, cost: { grain: 50 }, hp: 45, buildTime: 10,
        attack: { dmg: 4, range: 1.2, cooldown: 1.2 },
        speed: 6.5, model: 'worker', tags: ['light', 'worker', 'corrupt'],
        desc: 'Oath-bound flesh that labors without rest beneath the sigils.',
        trainedAt: 'fallen_spire',
      }),
      starmetal: U({
        name: 'Star-Metal Warrior', cost: { grain: 70, bronze: 50, favor: 10 }, hp: 170, buildTime: 14,
        attack: { dmg: 15, range: 1.7, cooldown: 1.1 },
        armor: 3, speed: 6.8, supply: 2, model: 'starmetal', tags: ['heavy', 'corrupt'],
        desc: 'Clad in iron that fell burning from the sky.',
        trainedAt: 'obsidian_gate',
      }),
      adept: U({
        name: 'Watcher Adept', cost: { grain: 60, bronze: 30, favor: 15 }, hp: 70, buildTime: 12,
        attack: { dmg: 11, range: 10.5, cooldown: 1.5, projectile: 'sigil', bonus: { heavy: 1.4 } },
        speed: 7, model: 'adept', tags: ['light', 'corrupt'], sight: 16,
        desc: 'Reads the unlawful names. Burning script unbinds bronze and bone.',
        trainedAt: 'obsidian_gate',
      }),
      skyfire: U({
        name: 'Skyfire Caster', cost: { grain: 100, bronze: 60, knowledge: 25 }, hp: 90, buildTime: 22,
        attack: { dmg: 30, range: 13, cooldown: 3.6, projectile: 'skyfire', aoe: 3.5 },
        speed: 6, supply: 3, model: 'skyfire', tags: ['light', 'corrupt'], sight: 17,
        desc: 'Calls down the falling star. The gathered host is made ash.',
        trainedAt: 'archive', requires: 'archive',
      }),
      hybrid: U({
        name: 'Nephilim Hybrid', cost: { grain: 140, bronze: 90, knowledge: 35 }, hp: 380, buildTime: 26,
        attack: { dmg: 28, range: 2.2, cooldown: 1.4, bonus: { structure: 2.2 } },
        armor: 3, speed: 7.5, supply: 4, model: 'hybrid', tags: ['massive', 'corrupt'], radius: 0.95,
        desc: 'Born of two worlds in the pits. Walls mean nothing to it.',
        trainedAt: 'hybrid_pit',
      }),
    },
    buildings: {
      fallen_spire: B({
        name: 'Fallen Spire', cost: { grain: 250, timber: 150 }, hp: 1300, buildTime: 50,
        size: 4, supplyProvided: 10, trains: ['servitor'], dropoff: true, favorRate: 3,
        model: 'spire', main: true, sight: 17,
        desc: 'Where the Watcher descended and did not return. The remnant gathers beneath it.',
      }),
      star_forge: B({
        name: 'Star Forge', cost: { grain: 60, timber: 70 }, hp: 420, buildTime: 15,
        size: 2, supplyProvided: 10, dropoff: true, model: 'starforge',
        desc: 'Smelts the sky-fallen iron. Shelters the bound.',
      }),
      obsidian_gate: B({
        name: 'Obsidian Gate', cost: { grain: 90, timber: 90, bronze: 20 }, hp: 600, buildTime: 22,
        size: 3, trains: ['starmetal', 'adept'], model: 'gate',
        desc: 'A ring of black stone. What is summoned through it serves.',
      }),
      archive: B({
        name: 'Forbidden Archive', cost: { grain: 100, timber: 80, bronze: 60 }, hp: 550, buildTime: 28,
        size: 3, trains: ['skyfire'], favorRate: 8, knowledgeRate: 2,
        upgrades: ['wat_script', 'wat_flesh'], requires: 'obsidian_gate', model: 'archive',
        desc: 'Tablets that should have burned. Each shelf is a sin and a weapon.',
      }),
      hybrid_pit: B({
        name: 'Hybrid Pit', cost: { grain: 120, timber: 60, bronze: 80 }, hp: 600, buildTime: 28,
        size: 3, trains: ['hybrid'], requires: 'archive', model: 'pit',
        desc: 'Flesh is rewritten here. The screaming is part of the process.',
      }),
      watcher_tower: B({
        name: 'Watcher Tower', cost: { timber: 80, bronze: 40 }, hp: 400, buildTime: 17,
        size: 2, attack: { dmg: 14, range: 13, cooldown: 1.5, projectile: 'sigil' },
        model: 'wtower', sight: 19,
        desc: 'An unblinking eye of obsidian. It remembers every trespass.',
      }),
    },
  },

  nephilim: {
    key: 'nephilim',
    name: 'The Nephilim Clans',
    color: 0xe05533, colorCss: '#e05533',
    glow: 0xff7a4d,
    accent: 0x7f241d, glow2: 0xff7a4d,   // Dried-Blood war-leather; ember light
    desc: 'Giant-blooded clans of the burning mountains. They do not build walls; they break them.',
    worker: 'thrall',
    main: 'clan_hearth',
    units: {
      thrall: U({
        name: 'Thrall Worker', worker: true, cost: { grain: 50 }, hp: 50, buildTime: 10,
        attack: { dmg: 5, range: 1.2, cooldown: 1.2 },
        speed: 6.5, model: 'worker', tags: ['light', 'worker'],
        desc: 'Taken in raids, kept by fear. Hauls bone and timber for the clans.',
        trainedAt: 'clan_hearth',
      }),
      raider: U({
        name: 'Giant-Blood Raider', cost: { grain: 60, bronze: 20 }, hp: 130, buildTime: 10,
        attack: { dmg: 13, range: 1.6, cooldown: 1.0, bonus: { worker: 1.6 } },
        speed: 9, supply: 2, model: 'raider', tags: ['light'],
        desc: 'Fast, half-giant, and hungry. Strikes the fields before the alarm sounds.',
        trainedAt: 'war_lodge',
      }),
      champion: U({
        name: 'Bone Club Champion', cost: { grain: 90, bronze: 60 }, hp: 260, buildTime: 16,
        attack: { dmg: 22, range: 1.8, cooldown: 1.3 },
        armor: 2, speed: 6.8, supply: 3, model: 'champion', tags: ['heavy'], radius: 0.75,
        desc: 'Carries the thighbone of his grandsire. It has opinions about your shield wall.',
        trainedAt: 'war_lodge',
      }),
      warbeast: U({
        name: 'War Beast', cost: { grain: 100, favor: 15 }, hp: 180, buildTime: 14,
        attack: { dmg: 15, range: 1.6, cooldown: 0.9, bonus: { light: 1.6, worker: 1.8 } },
        speed: 10.5, supply: 2, model: 'warbeast', tags: ['beast'], radius: 0.8,
        desc: 'Bred in the dens from things that should have drowned long ago.',
        trainedAt: 'beast_den',
      }),
      giant: U({
        name: 'Mountain Giant', cost: { grain: 200, bronze: 100, knowledge: 30 }, hp: 600, buildTime: 32,
        attack: { dmg: 40, range: 2.6, cooldown: 1.8, bonus: { structure: 2.5 } },
        armor: 4, speed: 5.5, supply: 6, model: 'giant', tags: ['massive'], radius: 1.4,
        desc: 'Older than the cities he ends. Gates are a suggestion.',
        trainedAt: 'beast_den', requires: 'totem',
      }),
      shaman: U({
        name: 'Clan Shaman', cost: { grain: 80, favor: 40 }, hp: 90, buildTime: 18,
        attack: { dmg: 20, range: 9.5, cooldown: 2.8, projectile: 'ember', aoe: 2.6 },
        speed: 6.5, supply: 2, model: 'shaman', tags: ['light'], sight: 16,
        desc: 'Burns the marrow of giants and speaks with what answers.',
        trainedAt: 'totem',
      }),
    },
    buildings: {
      clan_hearth: B({
        name: 'Clan Hearth', cost: { grain: 250, timber: 150 }, hp: 1500, buildTime: 50,
        size: 4, supplyProvided: 10, trains: ['thrall'], dropoff: true, favorRate: 2,
        model: 'hearth', main: true, sight: 15,
        desc: 'The fire that may not die. While it burns, the clans are one.',
      }),
      bone_pit: B({
        name: 'Bone Pit', cost: { grain: 50, timber: 60 }, hp: 450, buildTime: 13,
        size: 2, supplyProvided: 10, dropoff: true, model: 'bonepit',
        desc: 'Trophies, stores, and sleeping holes. Mind the smell.',
      }),
      war_lodge: B({
        name: 'War Lodge', cost: { grain: 90, timber: 90 }, hp: 650, buildTime: 20,
        size: 3, trains: ['raider', 'champion'], upgrades: ['nep_fury'], model: 'lodge',
        desc: 'Where boasts are made and then, occasionally, kept.',
      }),
      beast_den: B({
        name: 'Beast Den', cost: { grain: 100, timber: 80, bronze: 40 }, hp: 600, buildTime: 24,
        size: 3, trains: ['warbeast', 'giant'], requires: 'war_lodge', model: 'den',
        desc: 'Chains, meat, and patience. Two of the three usually hold.',
      }),
      totem: B({
        name: 'Totem of Dread', cost: { grain: 90, timber: 100, bronze: 30 }, hp: 500, buildTime: 24,
        size: 2, trains: ['shaman'], favorRate: 7, upgrades: ['nep_hide'],
        requires: 'war_lodge', model: 'totem',
        desc: 'Skulls of the drowned world. Enemies remember why they fear the mountains.',
      }),
      giant_cairn: B({
        name: 'Giant Cairn', cost: { timber: 70, bronze: 40 }, hp: 450, buildTime: 17,
        size: 2, attack: { dmg: 18, range: 12, cooldown: 2.0, projectile: 'rock' },
        model: 'cairn', sight: 17,
        desc: 'A dead giant\'s barrow. The clan throws stones from his shoulders.',
      }),
    },
  },
};

export const UPGRADES = {
  cov_weapons: { name: 'Tempered Bronze', cost: { bronze: 120, grain: 80 }, time: 25,
    effect: { dmgMult: 1.2 }, desc: '+20% unit damage.' },
  cov_armor:   { name: 'Scale Hauberks', cost: { bronze: 100, grain: 100 }, time: 25,
    effect: { armorAdd: 1 }, desc: '+1 unit armor.' },
  cov_zeal:    { name: 'Anointing Oil', cost: { favor: 80, grain: 60 }, time: 30,
    effect: { hpMult: 1.15 }, desc: '+15% unit health.' },
  wat_script:  { name: 'Burning Script', cost: { knowledge: 40, bronze: 80 }, time: 25,
    effect: { dmgMult: 1.2 }, desc: '+20% unit damage.' },
  wat_flesh:   { name: 'Graven Flesh', cost: { knowledge: 30, grain: 100 }, time: 25,
    effect: { hpMult: 1.2 }, desc: '+20% unit health.' },
  nep_fury:    { name: 'Blood of the First', cost: { favor: 60, grain: 100 }, time: 25,
    effect: { dmgMult: 1.2 }, desc: '+20% unit damage.' },
  nep_hide:    { name: 'Scarred Hides', cost: { grain: 120, bronze: 60 }, time: 25,
    effect: { armorAdd: 1 }, desc: '+1 unit armor.' },
};

// Neutral guardians of forbidden knowledge obelisks.
export const NEUTRALS = {
  devourer: U({
    name: 'Devourer', hp: 280, armor: 2,
    attack: { dmg: 20, range: 1.8, cooldown: 1.2 },
    speed: 7.5, model: 'devourer', tags: ['beast', 'massive'], radius: 0.9,
    aggroRange: 9, sight: 10,
    desc: 'It was left to guard the obelisk. It does not remember by whom.',
  }),
};

// ---- Easter egg: the Fields of Evil ----
// A blighted meadow where two ancient clans feud forever around a stubborn manor.
// Topple the House of Greene for a trove of Forbidden Knowledge. (Hostile to all.)
export const FIELDS_OF_EVIL = {
  units: {
    landonian: U({
      name: 'Landonian Marauder', hp: 170, armor: 1,
      attack: { dmg: 14, range: 1.6, cooldown: 1.1 },
      speed: 7.6, model: 'landonian', tags: ['heavy'], radius: 0.6, aggroRange: 13, sight: 14,
      desc: 'A clan that insists the Fields were theirs first. Loud, relentless, weirdly organized.',
    }),
    boydonian: U({
      name: 'Boydonian Zealot', hp: 210, armor: 2,
      attack: { dmg: 18, range: 1.7, cooldown: 1.2 },
      speed: 6.9, model: 'boydonian', tags: ['heavy'], radius: 0.72, aggroRange: 13, sight: 14,
      desc: 'Sworn rivals of the Landonians over a boundary no one else can see. They will not be moved.',
    }),
    warwagon: U({
      name: 'Landonian Warwagon', hp: 420, armor: 3,
      attack: { dmg: 26, range: 2.0, cooldown: 1.0, bonus: { worker: 1.6, light: 1.4 } },
      speed: 12, supply: 0, model: 'warwagon', tags: ['heavy', 'mounted'], radius: 0.95, aggroRange: 15, sight: 16,
      desc: 'A white war-chariot of impossible make, grille agleam, its lord reclined in the bed with a drink. The Landonians do not explain it. They simply arrive.',
    }),
    parker: U({
      name: 'Parker, Shepherd of the Fields', hp: 240, armor: 2,
      attack: { dmg: 12, range: 1.8, cooldown: 1.3 },
      speed: 5.5, model: 'parker', tags: ['light'], radius: 0.62,
      peaceful: true, aggroRange: 0, sight: 16,
      desc: 'The Shepherd of the Fields. He means no one harm — he only wants to know how you are doing, and to keep his flock from spooking. Raise a hand against him and even shepherds defend the fold.',
    }),
  },
  building: B({
    name: 'The House of Greene', hp: 1700, buildTime: 1, size: 3, model: 'house_of_greene', sight: 15,
    desc: 'A stubborn pre-flood manor at the heart of the Fields of Evil. It stood before the quarrel and means to outlast it. Topple it for a trove of forbidden knowledge.',
  }),
  reward: { knowledge: 500, favor: 200 },
};

// owner-2 (neutral) lookup tables used when reconstructing a saved game
export const NEUTRAL_UNIT_DEFS = {
  devourer: NEUTRALS.devourer,
  landonian: FIELDS_OF_EVIL.units.landonian,
  boydonian: FIELDS_OF_EVIL.units.boydonian,
  warwagon: FIELDS_OF_EVIL.units.warwagon,
  parker: FIELDS_OF_EVIL.units.parker,
};
export const NEUTRAL_BUILDING_DEFS = { house_of_greene: FIELDS_OF_EVIL.building };


export const RESOURCE_NODES = {
  grain:     { name: 'Wild Grain Field', amount: 1500, model: 'field',   carry: 10, gatherTime: 2.2 },
  timber:    { name: 'Cedar Stand',      amount: 1200, model: 'tree',    carry: 10, gatherTime: 2.4 },
  bronze:    { name: 'Bronze Lode',      amount: 1400, model: 'ore',     carry: 10, gatherTime: 2.6 },
  knowledge: { name: 'Graven Obelisk',   amount: 500,  model: 'obelisk', carry: 5,  gatherTime: 3.5 },
};

export const SUPPLY_CAP = 80;
export const START_RES = { grain: 300, timber: 200, bronze: 100, favor: 0, knowledge: 0 };
